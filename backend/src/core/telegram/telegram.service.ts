import { Injectable } from '@nestjs/common';

export interface SendMessageOptions {
  parseMode?: 'MarkdownV2' | 'HTML';
}

export interface SendMessageResult {
  ok: boolean;
}

@Injectable()
export class TelegramService {
  processUpdate(_update: unknown) {
    return { ok: true };
  }

  async sendMessage(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<SendMessageResult> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
    };

    if (options?.parseMode) {
      body.parse_mode = options.parseMode;
    }

    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      if (options?.parseMode) {
        return this.sendMessage(chatId, text, { parseMode: undefined });
      }
      const errBody = await res.text();
      throw new Error(`Telegram API error ${res.status}: ${errBody}`);
    }

    const json = (await res.json()) as { ok: boolean };
    return { ok: json.ok };
  }

  async sendTyping(chatId: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendChatAction`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Telegram API error ${res.status}: ${errBody}`);
    }
  }
}
