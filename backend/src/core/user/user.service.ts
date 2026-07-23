import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { User } from '../../generated/prisma/client.js';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findByChatId(chatId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { telegramChatId: chatId },
      include: { preference: true, connections: true },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: { preference: true, connections: true },
    });
  }

  async create(telegramChatId: string): Promise<User> {
    return this.prisma.user.create({
      data: { telegramChatId },
      include: { preference: true, connections: true },
    });
  }
}
