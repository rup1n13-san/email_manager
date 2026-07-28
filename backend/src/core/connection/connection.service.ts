import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EncryptionHelper } from '../../common/helpers/encryption.js';

@Injectable()
export class ConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionHelper,
  ) {}

  async storeTokens(
    chatId: string,
    providerUserId: string,
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

    return this.prisma.connection.upsert({
      where: { userId_provider: { userId: user.id, provider: 'google' } },
      create: {
        userId: user.id,
        providerUserId,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt,
      },
      update: {
        providerUserId,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt,
      },
    });
  }

  async getTokens(chatId: string) {
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

  async deleteTokens(chatId: string) {
    const user = await this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
    });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.connection.deleteMany({
      where: { userId: user.id, provider: 'google' },
    });
  }
}
