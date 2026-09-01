import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

const include = { settings: true, connections: true } as const;

export type UserWithRelations = Prisma.UserGetPayload<{
  include: typeof include;
}>;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByChatId(chatId: string): Promise<UserWithRelations | null> {
    this.logger.debug(`Looking up user by chat=${chatId}`);
    return this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
      include,
    });
  }

  async findById(id: string): Promise<UserWithRelations | null> {
    this.logger.debug(`Looking up user by id=${id}`);
    return this.prisma.user.findUnique({
      where: { id },
      include,
    });
  }

  async create(telegramChatId: string): Promise<UserWithRelations> {
    const user = await this.prisma.user.create({
      data: { telegramChatId, settings: { create: {} } },
      include,
    });
    this.logger.log(`Created new user for chat=${telegramChatId}`);
    return user;
  }
}
