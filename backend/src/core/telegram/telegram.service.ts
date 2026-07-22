import { Injectable } from '@nestjs/common';

@Injectable()
export class TelegramService {
  processUpdate(_update: unknown) {
    return { ok: true };
  }

  sendMessage(chatId: string, text: string) {
    return { chatId, text };
  }
}
