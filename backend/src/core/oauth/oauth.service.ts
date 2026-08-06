import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { ConnectionService } from '../connection/connection.service.js';
import { TelegramService } from '../telegram/telegram.service.js';

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly connectionService: ConnectionService,
    private readonly telegramService: TelegramService,
  ) {}

  async handleCallback(code: string, state: string) {
    this.logger.log(`Handling OAuth callback for chat=${state}`);

    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri,
    );

    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token) {
      throw new Error('No access token received from Google');
    }

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userinfo } = await oauth2.userinfo.get();

    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600_000);

    await this.connectionService.storeTokens(
      state,
      userinfo.id ?? 'unknown',
      userinfo.email ?? null,
      tokens.access_token,
      tokens.refresh_token ?? '',
      expiresAt,
    );

    await this.telegramService.sendMessage(
      state,
      `✅ Gmail connected as ${userinfo.email}`,
    );

    this.logger.log(
      `Gmail connected for chat=${state}, email=${userinfo.email}`,
    );
  }
}
