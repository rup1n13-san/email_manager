import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EncryptionHelper } from '../../common/helpers/encryption.js';
import { revokeGoogleToken } from '../../common/helpers/oauth-revoke.js';
import {
  ConnectionProvider,
  ConnectionStatus,
  Prisma,
} from '../../generated/prisma/client.js';

const PENDING_TTL_MS = 10 * 60_000;

// Token columns are deliberately absent: only getActiveTokens() needs ciphertext.
const activeAccountArgs = {
  select: {
    id: true,
    activeConnectionId: true,
    connections: {
      where: {
        provider: ConnectionProvider.GOOGLE,
        status: ConnectionStatus.CONFIRMED,
      },
      select: { id: true, email: true, providerAccountId: true },
      orderBy: { createdAt: 'asc' },
    },
  },
} as const;

export type ActiveAccount = Prisma.UserGetPayload<
  typeof activeAccountArgs
>['connections'][number];

export type ActiveAccountResult =
  | { status: 'active'; account: ActiveAccount }
  | { status: 'none' }
  | { status: 'ambiguous'; accounts: ActiveAccount[] };

export interface ActiveTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

export type ActiveTokensResult =
  | { status: 'active'; account: ActiveAccount; tokens: ActiveTokens }
  | { status: 'none' }
  | { status: 'ambiguous'; accounts: ActiveAccount[] };

export type SetActiveResult =
  | { status: 'switched'; email: string }
  | { status: 'ambiguous'; accounts: ActiveAccount[] };

export type DisconnectResult =
  | {
      status: 'disconnected';
      email: string;
      revoked: boolean;
      // null when the removed account was not the active one — nothing changed.
      activeAfter: ActiveAccountResult | null;
    }
  | {
      status: 'ambiguous';
      accounts: { email: string; providerAccountId: string }[];
    };

@Injectable()
export class ConnectionService {
  private readonly logger = new Logger(ConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionHelper,
  ) {}

  async storeTokens(
    chatId: string,
    providerAccountId: string,
    email: string,
    accessToken: string,
    refreshToken: string | null,
    expiresAt: Date,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
    });
    if (!user) throw new NotFoundException('User not found');

    const encryptedAccess = this.encryption.encrypt(accessToken);
    const encryptedRefresh = refreshToken
      ? this.encryption.encrypt(refreshToken)
      : null;

    const result = await this.prisma.connection.upsert({
      where: {
        userId_provider_providerAccountId: {
          userId: user.id,
          provider: ConnectionProvider.GOOGLE,
          providerAccountId,
        },
      },
      create: {
        userId: user.id,
        providerAccountId,
        email,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt,
        status: ConnectionStatus.PENDING_CONFIRMATION,
      },
      update: {
        email,
        accessToken: encryptedAccess,
        // Google only returns a refresh token on first consent — never clear a stored one.
        ...(encryptedRefresh ? { refreshToken: encryptedRefresh } : {}),
        expiresAt,
      },
    });
    this.logger.log(`Stored Google tokens for chat=${chatId}`);
    return result;
  }

  async getActiveTokens(chatId: string): Promise<ActiveTokensResult> {
    const active = await this.getActive(chatId);
    if (active.status !== 'active') return active;

    const connection = await this.prisma.connection.findUnique({
      where: { id: active.account.id },
      select: { accessToken: true, refreshToken: true, expiresAt: true },
    });
    // Deleted between resolving and reading: no usable account, not an error.
    if (!connection) return { status: 'none' };

    return {
      status: 'active',
      account: active.account,
      tokens: {
        accessToken: this.encryption.decrypt(connection.accessToken),
        refreshToken: connection.refreshToken
          ? this.encryption.decrypt(connection.refreshToken)
          : null,
        expiresAt: connection.expiresAt,
      },
    };
  }

  async updateAccessToken(
    connectionId: string,
    accessToken: string,
    expiresAt: Date,
  ): Promise<void> {
    // updateMany over update: a row already deleted by a concurrent
    // /disconnect matches zero rows instead of throwing P2025.
    await this.prisma.connection.updateMany({
      where: { id: connectionId },
      data: {
        accessToken: this.encryption.encrypt(accessToken),
        expiresAt,
      },
    });
  }

  async listConnections(
    chatId: string,
  ): Promise<{ email: string; providerAccountId: string }[]> {
    const user = await this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
      include: { connections: true },
    });
    if (!user) return [];

    return user.connections
      .filter(
        (c) =>
          c.provider === ConnectionProvider.GOOGLE &&
          c.status === ConnectionStatus.CONFIRMED,
      )
      .map((c) => ({ email: c.email, providerAccountId: c.providerAccountId }));
  }

  async getActive(chatId: string): Promise<ActiveAccountResult> {
    const user = await this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
      ...activeAccountArgs,
    });
    if (!user || user.connections.length === 0) return { status: 'none' };

    const accounts = user.connections;

    // A lone account is active by definition, even if the pointer was never set
    // or was cleared by onDelete: SetNull.
    if (accounts.length === 1) {
      const account = accounts[0];
      if (user.activeConnectionId !== account.id) {
        await this.healActivePointer(user.id, account.id);
      }
      return { status: 'active', account };
    }

    const account = accounts.find((c) => c.id === user.activeConnectionId);
    return account
      ? { status: 'active', account }
      : { status: 'ambiguous', accounts };
  }

  async setActive(chatId: string, email?: string): Promise<SetActiveResult> {
    const user = await this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
      ...activeAccountArgs,
    });
    const accounts = user?.connections ?? [];

    if (!user || accounts.length === 0) {
      throw new NotFoundException('You have no connected Gmail accounts.');
    }

    let target = accounts[0];
    if (email) {
      const match = accounts.find(
        (c) => c.email.toLowerCase() === email.toLowerCase(),
      );
      if (!match) {
        throw new NotFoundException(`No connected account found for ${email}.`);
      }
      target = match;
    } else if (accounts.length > 1) {
      return { status: 'ambiguous', accounts };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { activeConnectionId: target.id },
    });
    this.logger.log(`Active connection set to id=${target.id} chat=${chatId}`);

    return { status: 'switched', email: target.email };
  }

  // Best-effort: a concurrent /disconnect can delete the row, and a failed repair
  // must not break the read that triggered it.
  private async healActivePointer(
    userId: string,
    connectionId: string,
  ): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { activeConnectionId: connectionId },
      });
    } catch (error) {
      this.logger.warn(
        `Could not set active connection ${connectionId} for user=${userId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async disconnect(chatId: string, email?: string): Promise<DisconnectResult> {
    const user = await this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
      include: { connections: true },
    });
    const connections = (user?.connections ?? []).filter(
      (c) =>
        c.provider === ConnectionProvider.GOOGLE &&
        c.status === ConnectionStatus.CONFIRMED,
    );

    if (connections.length === 0) {
      throw new NotFoundException('You have no connected Gmail accounts.');
    }

    let target = connections[0];
    if (email) {
      const match = connections.find(
        (c) => c.email.toLowerCase() === email.toLowerCase(),
      );
      if (!match) {
        throw new NotFoundException(`No connected account found for ${email}.`);
      }
      target = match;
    } else if (connections.length > 1) {
      return {
        status: 'ambiguous',
        accounts: connections.map((c) => ({
          email: c.email,
          providerAccountId: c.providerAccountId,
        })),
      };
    }

    const wasActive = user?.activeConnectionId === target.id;
    const refreshToken = target.refreshToken
      ? this.encryption.decrypt(target.refreshToken)
      : null;
    const accessToken = this.encryption.decrypt(target.accessToken);
    const revoked = await revokeGoogleToken(refreshToken ?? accessToken);

    // deleteMany over delete: a row already deleted by a concurrent
    // /disconnect matches zero rows instead of throwing P2025.
    await this.prisma.connection.deleteMany({ where: { id: target.id } });
    this.logger.log(
      `Disconnected connection id=${target.id} chat=${chatId} revoked=${revoked}`,
    );

    // Re-resolving instead of picking a survivor: when several remain the pointer
    // deliberately stays unset so the user chooses.
    const activeAfter = wasActive ? await this.getActive(chatId) : null;

    return {
      status: 'disconnected',
      email: target.email,
      revoked,
      activeAfter,
    };
  }

  async confirmConnection(
    id: string,
    chatId: string,
  ): Promise<{ ok: boolean; email?: string }> {
    const connection = await this.prisma.connection.findUnique({
      where: { id },
      include: { user: { select: { telegramChatId: true } } },
    });
    if (!connection || connection.user.telegramChatId !== chatId) {
      return { ok: false };
    }

    const { count } = await this.prisma.connection.updateMany({
      where: { id, status: ConnectionStatus.PENDING_CONFIRMATION },
      data: { status: ConnectionStatus.CONFIRMED },
    });
    if (count === 0) return { ok: false };

    // The null guard makes "activate if unset" atomic — no race with a /switch.
    await this.prisma.user.updateMany({
      where: { id: connection.userId, activeConnectionId: null },
      data: { activeConnectionId: id },
    });

    this.logger.log(`Confirmed connection id=${id} chat=${chatId}`);
    return { ok: true, email: connection.email };
  }

  async rejectConnection(
    id: string,
    chatId: string,
  ): Promise<{ ok: boolean; email?: string }> {
    const connection = await this.prisma.connection.findUnique({
      where: { id },
      include: { user: { select: { telegramChatId: true } } },
    });
    if (
      !connection ||
      connection.user.telegramChatId !== chatId ||
      connection.status !== ConnectionStatus.PENDING_CONFIRMATION
    ) {
      return { ok: false };
    }

    // Delete first: whoever wins this atomic, status-guarded delete owns the revoke.
    // Revoking first would kill the Google grant even when a concurrent confirm won the row.
    const { count } = await this.prisma.connection.deleteMany({
      where: { id, status: ConnectionStatus.PENDING_CONFIRMATION },
    });
    if (count === 0) return { ok: false };

    await this.revokePendingTokens(connection);
    this.logger.log(`Rejected connection id=${id} chat=${chatId}`);
    return { ok: true, email: connection.email };
  }

  async sweepStalePending(): Promise<void> {
    const stale = await this.prisma.connection.findMany({
      where: {
        status: ConnectionStatus.PENDING_CONFIRMATION,
        updatedAt: { lt: new Date(Date.now() - PENDING_TTL_MS) },
      },
    });
    if (stale.length === 0) return;

    let swept = 0;
    for (const connection of stale) {
      const { count } = await this.prisma.connection.deleteMany({
        where: {
          id: connection.id,
          status: ConnectionStatus.PENDING_CONFIRMATION,
        },
      });
      if (count === 0) continue; // a concurrent confirm won this row
      await this.revokePendingTokens(connection);
      swept++;
    }
    if (swept > 0) {
      this.logger.log(`Swept ${swept} stale pending connection(s)`);
    }
  }

  private async revokePendingTokens(connection: {
    accessToken: string;
    refreshToken: string | null;
  }): Promise<void> {
    const refreshToken = connection.refreshToken
      ? this.encryption.decrypt(connection.refreshToken)
      : null;
    const accessToken = this.encryption.decrypt(connection.accessToken);
    await revokeGoogleToken(refreshToken ?? accessToken);
  }
}
