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

export type DisconnectResult =
  | { status: 'disconnected'; email: string; revoked: boolean }
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

  async getTokens(chatId: string) {
    this.logger.debug(`Fetching tokens for chat=${chatId}`);
    const user = await this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
      include: { connections: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const connection = user.connections.find(
      (c) =>
        c.provider === ConnectionProvider.GOOGLE &&
        c.status === ConnectionStatus.CONFIRMED,
    );
    if (!connection) return null;

    return {
      accessToken: this.encryption.decrypt(connection.accessToken),
      refreshToken: connection.refreshToken
        ? this.encryption.decrypt(connection.refreshToken)
        : null,
      expiresAt: connection.expiresAt,
    };
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

    const refreshToken = target.refreshToken
      ? this.encryption.decrypt(target.refreshToken)
      : null;
    const accessToken = this.encryption.decrypt(target.accessToken);
    const revoked = await revokeGoogleToken(refreshToken ?? accessToken);

    try {
      await this.prisma.connection.delete({ where: { id: target.id } });
    } catch (error) {
      if (!(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      )) {
        throw error;
      }
    }
    this.logger.log(
      `Disconnected connection id=${target.id} chat=${chatId} revoked=${revoked}`,
    );

    return { status: 'disconnected', email: target.email, revoked };
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

  // Safe to revoke unconditionally: the unique constraint on
  // [userId, provider, providerAccountId] guarantees no other row
  // (pending or confirmed) can share this account's tokens.
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
