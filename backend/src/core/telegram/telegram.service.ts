import { Injectable } from '@nestjs/common';
import { UserService } from '../user/user.service.js';
import { TelegramUpdate } from './dto/telegram-update.dto.js';
import { buildGoogleOAuthUrl } from '../../common/helpers/oauth-url.js';

export interface SendMessageOptions {
  parseMode?: 'MarkdownV2' | 'HTML';
}

export interface SendMessageResult {
  ok: boolean;
}

@Injectable()
export class TelegramService {
  constructor(private readonly userService: UserService) {}

  async processUpdate(update: TelegramUpdate): Promise<{ ok: boolean }> {
    const message = update.message;
    if (!message?.text) return { ok: true };

    const isCommand = message.entities?.some((e) => e.type === 'bot_command');
    if (!isCommand) return { ok: true };

    const chatId = String(message.chat.id);
    const parts = message.text.trim().split(/\s+/);
    const command = parts[0];

    switch (command) {
      case '/start':
        return this.handleStart(chatId, message.from);
      case '/help':
        return this.handleHelp(chatId);
      case '/connect':
        return this.handleConnect(chatId);
      default:
        await this.sendMessage(chatId, `Unknown command: ${command}`);
        return { ok: true };
    }
  }

  private async handleStart(
    chatId: string,
    from: { id: number; first_name: string; username?: string },
  ): Promise<{ ok: boolean }> {
    const existing = await this.userService.findByChatId(chatId);

    if (existing) {
      await this.sendMessage(
        chatId,
        `Welcome back, ${from.first_name}! Use /connect to link your Gmail.`,
      );
      return { ok: true };
    }

    await this.userService.create(chatId);
    await this.sendMessage(
      chatId,
      `Welcome, ${from.first_name}! I'm your Email Manager bot.\n\n` +
        `Here's what I can do:\n` +
        `/connect — Link your Gmail account\n` +
        `/disconnect — Remove your Gmail connection\n` +
        `/search — Search your emails\n` +
        `/write — Send an email\n` +
        `/summary — Get AI summary of new emails\n` +
        `/help — Show this message again`,
    );
    return { ok: true };
  }

  private async handleConnect(chatId: string): Promise<{ ok: boolean }> {
    try {
      const url = buildGoogleOAuthUrl(chatId);
      await this.sendMessage(
        chatId,
        `Click to connect your Gmail account:\n\n${url}\n\n` +
          `After authorizing, you'll receive a confirmation message here.`,
      );
    } catch {
      await this.sendMessage(
        chatId,
        'Google OAuth is not configured. Contact the bot admin.',
      );
    }
    return { ok: true };
  }

  private async handleHelp(chatId: string): Promise<{ ok: boolean }> {
    await this.sendMessage(
      chatId,
      `I can help you manage your Gmail from Telegram.\n\n` +
        `Start by sending /connect to link your account.\n\n` +
        `Commands:\n` +
        `/connect — Link Gmail\n` +
        `/disconnect — Unlink Gmail\n` +
        `/search <query> — Search emails\n` +
        `/write to:... subject:... body:... — Send email\n` +
        `/summary — AI summary of recent emails\n` +
        `/help — This message`,
    );
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
