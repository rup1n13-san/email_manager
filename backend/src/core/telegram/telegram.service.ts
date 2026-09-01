import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UserService } from '../user/user.service.js';
import { ConnectionService } from '../connection/connection.service.js';
import {
  TelegramUpdate,
  TelegramCallbackQuery,
} from './dto/telegram-update.dto.js';
import { buildGoogleOAuthUrl } from '../../common/helpers/oauth-url.js';
import { encodeOAuthState } from '../../common/helpers/oauth-state.js';
import { ConnectionProvider } from '../../generated/prisma/client.js';

export interface InlineKeyboardMarkup {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface SendMessageOptions {
  parseMode?: 'MarkdownV2' | 'HTML';
  replyMarkup?: InlineKeyboardMarkup;
}

export interface SendMessageResult {
  ok: boolean;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly userService: UserService,
    private readonly connectionService: ConnectionService,
  ) {}

  async processUpdate(update: TelegramUpdate): Promise<{ ok: boolean }> {
    if (update.callback_query) {
      return this.handleCallbackQuery(update.callback_query);
    }

    const message = update.message;
    if (!message?.text) return { ok: true };

    // Only private chats: in a group, chat.id is the group's, so a connection
    // would be bound to a record every member shares.
    if (message.chat.type !== 'private') return { ok: true };

    const isCommand = message.entities?.some((e) => e.type === 'bot_command');
    if (!isCommand) return { ok: true };

    const chatId = String(message.chat.id);
    const parts = message.text.trim().split(/\s+/);
    const command = parts[0];

    this.logger.debug(`Received command ${command} from chat=${chatId}`);

    switch (command) {
      case '/start':
        return this.handleStart(chatId, message.from);
      case '/help':
        return this.handleHelp(chatId);
      case '/connect':
        return this.handleConnect(chatId);
      case '/list':
        return this.handleList(chatId);
      case '/disconnect':
        return this.handleDisconnect(chatId, parts[1]);
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
        `/list — Show your connected Gmail accounts\n` +
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
      // The callback binds tokens to this chat's user, so it must exist first.
      const existing = await this.userService.findByChatId(chatId);
      if (!existing) await this.userService.create(chatId);

      const url = buildGoogleOAuthUrl(
        encodeOAuthState(chatId, ConnectionProvider.GOOGLE),
      );
      await this.sendMessage(
        chatId,
        `Click to connect your Gmail account:\n\n${url}\n\n` +
          `After authorizing, you'll be asked here to confirm the account.`,
      );
    } catch (error) {
      this.logger.warn(
        `/connect failed for chat=${chatId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.sendMessage(
        chatId,
        'Google OAuth is not configured. Contact the bot admin.',
      );
    }
    return { ok: true };
  }

  private async handleList(chatId: string): Promise<{ ok: boolean }> {
    const connections = await this.connectionService.listConnections(chatId);

    if (connections.length === 0) {
      await this.sendMessage(
        chatId,
        "You don't have any connected Gmail accounts yet. Use /connect to link one.",
      );
      return { ok: true };
    }

    const lines = connections.map(
      (c, i) =>
        `${i + 1}. ${c.email ?? '(email unknown — reconnect with /connect to refresh)'}`,
    );
    await this.sendMessage(
      chatId,
      `Connected Gmail accounts:\n\n${lines.join('\n')}\n\n` +
        (connections.length > 1
          ? 'Use /disconnect <email> to remove one.'
          : 'Use /disconnect to remove it.'),
    );
    return { ok: true };
  }

  private async handleDisconnect(
    chatId: string,
    emailArg?: string,
  ): Promise<{ ok: boolean }> {
    try {
      const result = await this.connectionService.disconnect(chatId, emailArg);

      if (result.status === 'ambiguous') {
        const lines = result.accounts.map(
          (a) => `- ${a.email ?? '(email unknown)'}`,
        );
        await this.sendMessage(
          chatId,
          `You have multiple connected accounts. Which one?\n\n${lines.join('\n')}\n\n` +
            `Reply with /disconnect <email>`,
        );
        return { ok: true };
      }

      const label = result.email ?? 'that account';
      await this.sendMessage(
        chatId,
        result.revoked
          ? `Disconnected ${label}. Google access has been revoked.`
          : `Disconnected ${label} locally, but revoking Google access failed. ` +
              `Please remove it manually at https://myaccount.google.com/permissions`,
      );
      return { ok: true };
    } catch (error) {
      if (error instanceof NotFoundException) {
        await this.sendMessage(chatId, error.message);
        return { ok: true };
      }
      throw error;
    }
  }

  private async handleHelp(chatId: string): Promise<{ ok: boolean }> {
    await this.sendMessage(
      chatId,
      `I can help you manage your Gmail from Telegram.\n\n` +
        `Start by sending /connect to link your account.\n\n` +
        `Commands:\n` +
        `/connect — Link Gmail\n` +
        `/list — Show connected Gmail accounts\n` +
        `/disconnect — Unlink Gmail\n` +
        `/search <query> — Search emails\n` +
        `/write to:... subject:... body:... — Send email\n` +
        `/summary — AI summary of recent emails\n` +
        `/help — This message`,
    );
    return { ok: true };
  }

  async sendConnectionConfirmationPrompt(
    chatId: string,
    connectionId: string,
    email: string,
  ): Promise<void> {
    await this.sendMessage(
      chatId,
      `Connect ${email}?\n\n` +
        `This account is not linked yet. Confirm to finish, or reject to cancel and revoke access.`,
      {
        replyMarkup: {
          inline_keyboard: [
            [
              { text: 'Confirm', callback_data: `c:${connectionId}` },
              { text: 'Reject', callback_data: `r:${connectionId}` },
            ],
          ],
        },
      },
    );
  }

  private async handleCallbackQuery(
    query: TelegramCallbackQuery,
  ): Promise<{ ok: boolean }> {
    // from.id identifies the human who tapped — not the chat the message sits
    // in — so a forwarded button can't act on someone else's connection.
    const chatId = String(query.from.id);
    const [action, connectionId] = (query.data ?? '').split(':');

    let notice = 'This button is no longer valid.';

    if (connectionId && (action === 'c' || action === 'r')) {
      const result =
        action === 'c'
          ? await this.connectionService.confirmConnection(connectionId, chatId)
          : await this.connectionService.rejectConnection(connectionId, chatId);

      if (result.ok) {
        notice = action === 'c' ? 'Connected' : 'Cancelled';
        await this.sendMessage(
          chatId,
          action === 'c'
            ? `✅ Gmail connected as ${result.email}`
            : `Cancelled — ${result.email} was not linked and its access has been revoked.`,
        );
        if (query.message) {
          await this.editMessageReplyMarkup(
            String(query.message.chat.id),
            query.message.message_id,
          );
        }
      } else {
        notice = 'Already handled or expired.';
      }
    }

    await this.answerCallbackQuery(query.id, notice);
    return { ok: true };
  }

  async answerCallbackQuery(queryId: string, text?: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    const res = await fetch(
      `https://api.telegram.org/bot${token}/answerCallbackQuery`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: queryId, text }),
      },
    );

    // Cosmetic only (dismisses the client spinner). Never fail the webhook over
    // it — a thrown error would make Telegram redeliver the whole update.
    if (!res.ok) {
      this.logger.warn(
        `Telegram answerCallbackQuery failed: ${res.status} ${await res.text()}`,
      );
    }
  }

  async editMessageReplyMarkup(
    chatId: string,
    messageId: number,
  ): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    const res = await fetch(
      `https://api.telegram.org/bot${token}/editMessageReplyMarkup`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [] },
        }),
      },
    );

    // Cosmetic (strips the buttons); same reasoning as answerCallbackQuery.
    if (!res.ok) {
      this.logger.warn(
        `Telegram editMessageReplyMarkup failed: ${res.status} ${await res.text()}`,
      );
    }
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

    if (options?.replyMarkup) {
      body.reply_markup = options.replyMarkup;
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
      // Only a 400 can be a parse-mode problem. Retrying on 429/5xx would mask
      // rate limits and outages as formatting errors.
      if (options?.parseMode && res.status === 400) {
        return this.sendMessage(chatId, text, {
          ...options,
          parseMode: undefined,
        });
      }
      const errBody = await res.text();
      this.logger.error(
        `Telegram sendMessage failed for chat=${chatId}: ${res.status} ${errBody}`,
      );
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
      this.logger.error(
        `Telegram sendTyping failed for chat=${chatId}: ${res.status} ${errBody}`,
      );
      throw new Error(`Telegram API error ${res.status}: ${errBody}`);
    }
  }
}
