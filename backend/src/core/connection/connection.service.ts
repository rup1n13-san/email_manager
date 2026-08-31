import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EncryptionHelper } from '../../common/helpers/encryption.js';
import { revokeGoogleToken } from '../../common/helpers/oauth-revoke.js';
import { Prisma } from '../../generated/prisma/client.js';

export type DisconnectResult =
  | { status: 'disconnected'; email: string | null; revoked: boolean }
  | {
      status: 'ambiguous';
      accounts: { email: string | null; providerUserId: string }[];
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
    providerUserId: string,
    email: string | null,
    accessToken: string,
    refreshToken: string,
    expiresAt: Date,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
    });
    if (!user) throw new NotFoundException('User not found');

    const encryptedAccess = this.encryption.encrypt(accessToken);
    const encryptedRefresh = this.encryption.encrypt(refreshToken);

    const result = await this.prisma.connection.upsert({
      where: {
        userId_provider_providerUserId: {
          userId: user.id,
          provider: 'google',
          providerUserId,
        },
      },
      create: {
        userId: user.id,
        providerUserId,
        email,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt,
      },
      update: {
        email,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
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

    const connection = user.connections.find((c) => c.provider === 'google');
    if (!connection) return null;

    return {
      accessToken: this.encryption.decrypt(connection.accessToken),
      refreshToken: this.encryption.decrypt(connection.refreshToken),
      expiresAt: connection.expiresAt,
    };
  }

  async listConnections(
    chatId: string,
  ): Promise<{ email: string | null; providerUserId: string }[]> {
    const user = await this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
      include: { connections: true },
    });
    if (!user) return [];

    return user.connections
      .filter((c) => c.provider === 'google')
      .map((c) => ({ email: c.email, providerUserId: c.providerUserId }));
  }

  async disconnect(chatId: string, email?: string): Promise<DisconnectResult> {
    const user = await this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
      include: { connections: true },
    });
    const connections = (user?.connections ?? []).filter(
      (c) => c.provider === 'google',
    );

    if (connections.length === 0) {
      throw new NotFoundException('You have no connected Gmail accounts.');
    }

    let target = connections[0];
    if (email) {
      const match = connections.find(
        (c) => c.email?.toLowerCase() === email.toLowerCase(),
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
          providerUserId: c.providerUserId,
        })),
      };
    }

    const refreshToken = this.encryption.decrypt(target.refreshToken);
    const accessToken = this.encryption.decrypt(target.accessToken);
    const revoked = await revokeGoogleToken(refreshToken || accessToken);

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
}
