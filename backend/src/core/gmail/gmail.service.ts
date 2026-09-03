import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import {
  ConnectionService,
  ActiveAccount,
} from '../connection/connection.service.js';

export type GmailClientResult =
  | { status: 'active'; gmail: gmail_v1.Gmail; account: ActiveAccount }
  | { status: 'none' }
  | { status: 'ambiguous'; accounts: ActiveAccount[] }
  | { status: 'needs_reconnect' };

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(private readonly connectionService: ConnectionService) {}

  private async getClient(chatId: string): Promise<GmailClientResult> {
    const result = await this.connectionService.getActiveTokens(chatId);
    if (result.status !== 'active') return result;

    const { account, tokens } = result;
    if (!tokens.refreshToken) return { status: 'needs_reconnect' };

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
    oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt.getTime(),
    });
    oauth2Client.on('tokens', (newTokens) => {
      if (!newTokens.access_token) return;
      const expiresAt = newTokens.expiry_date
        ? new Date(newTokens.expiry_date)
        : new Date(Date.now() + 3600_000);
      this.connectionService
        .updateAccessToken(account.id, newTokens.access_token, expiresAt)
        .catch((error: unknown) =>
          this.logger.warn(
            `Failed to persist refreshed token for connection=${account.id}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    });

    return {
      status: 'active',
      gmail: google.gmail({ version: 'v1', auth: oauth2Client }),
      account,
    };
  }

  listEmails() {
    this.logger.debug('listEmails called');
    return [];
  }

  searchEmails(query: string) {
    this.logger.debug(`searchEmails called with query="${query}"`);
    return { query };
  }

  getEmail(id: string) {
    this.logger.debug(`getEmail called for id=${id}`);
    return { id };
  }

  sendEmail() {
    this.logger.debug('sendEmail called');
    return { sent: true };
  }
}
