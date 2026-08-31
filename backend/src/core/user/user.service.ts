import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { User } from '../../generated/prisma/client.js';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByChatId(chatId: string): Promise<User | null> {
    this.logger.debug(`Looking up user by chat=${chatId}`);
    return this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
      include: { preference: true, connections: true },
    });
  }

  async findById(id: string): Promise<User | null> {
    this.logger.debug(`Looking up user by id=${id}`);
    return this.prisma.user.findUnique({
      where: { id },
      include: { preference: true, connections: true },
    });
  }

  async create(telegramChatId: string): Promise<User> {
    const user = await this.prisma.user.create({
      data: { telegramChatId },
      include: { preference: true, connections: true },
    });
    this.logger.log(`Created new user for chat=${telegramChatId}`);
    return user;
  }
}
