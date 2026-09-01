import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { ConnectionService } from '../connection/connection.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { decodeOAuthState } from '../../common/helpers/oauth-state.js';
import { ConnectionProvider } from '../../generated/prisma/client.js';

export class InvalidOAuthStateError extends Error {
  constructor() {
    super('Invalid or expired authorization link');
  }
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly connectionService: ConnectionService,
    private readonly telegramService: TelegramService,
  ) {}

  async handleCallback(code: string, state: string) {
    // Never log the raw state — for its TTL it authorizes binding a Google
    // account to a chat.
    const decoded = decodeOAuthState(state, ConnectionProvider.GOOGLE);
    if (!decoded) {
      this.logger.warn('Rejected OAuth callback: invalid or expired state');
      throw new InvalidOAuthStateError();
    }
    const chatId = decoded.chatId;
    this.logger.log(`Handling OAuth callback for chat=${chatId}`);

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );

    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token) {
      throw new Error('No access token received from Google');
    }

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userinfo } = await oauth2.userinfo.get();

    if (!userinfo.id || !userinfo.email) {
      throw new Error('Google did not return an account id and email');
    }

    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600_000);

    const connection = await this.connectionService.storeTokens(
      chatId,
      userinfo.id,
      userinfo.email,
      tokens.access_token,
      tokens.refresh_token ?? null,
      expiresAt,
    );

    await this.telegramService.sendConnectionConfirmationPrompt(
      chatId,
      connection.id,
      userinfo.email,
    );

    this.logger.log(
      `Awaiting confirmation for chat=${chatId}, email=${userinfo.email}`,
    );
  }

  async handleCallbackError(state: string, error: string) {
    const decoded = decodeOAuthState(state, ConnectionProvider.GOOGLE);
    if (!decoded) {
      this.logger.warn(
        'Rejected OAuth error callback: invalid or expired state',
      );
      throw new InvalidOAuthStateError();
    }

    this.logger.log(
      `Google returned error=${error} for chat=${decoded.chatId}`,
    );
    await this.telegramService.sendMessage(
      decoded.chatId,
      'Gmail connection was cancelled. Use /connect to try again.',
    );
  }
}
