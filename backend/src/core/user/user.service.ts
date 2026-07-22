import { Injectable } from '@nestjs/common';

@Injectable()
export class UserService {
  findByChatId(chatId: string) {
    return { chatId };
  }

  create(chatId: string) {
    return { chatId };
  }
}
