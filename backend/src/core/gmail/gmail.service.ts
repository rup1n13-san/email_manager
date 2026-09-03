import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import {
  ConnectionService,
  ActiveAccount,
} from '../connection/connection.service.js';
import { classifyGmailError } from '../../common/helpers/gmail-error.js';

export type GmailClientResult =
  | { status: 'active'; gmail: gmail_v1.Gmail; account: ActiveAccount }
  | { status: 'none' }
  | { status: 'ambiguous'; accounts: ActiveAccount[] }
  | { status: 'needs_reconnect' };

export interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

type GmailNonActive = Exclude<GmailClientResult, { status: 'active' }>;
type GmailApiError =
  | { status: 'needs_reconnect' }
  | { status: 'not_found' }
  | { status: 'rate_limited' }
  | { status: 'unknown'; message: string };

export type GmailResult<T> =
  { status: 'ok'; data: T } | GmailNonActive | GmailApiError;

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

  async listEmails(
    chatId: string,
    maxResults = 20,
  ): Promise<GmailResult<EmailSummary[]>> {
    const client = await this.getClient(chatId);
    if (client.status !== 'active') return client;

    try {
      const ids = await this.collectMessageIds(client.gmail, maxResults);
      const messages = await Promise.all(
        ids.map((id) => this.getMessageSummary(client.gmail, id)),
      );
      return { status: 'ok', data: messages };
    } catch (error) {
      return this.toApiError(error);
    }
  }

  private async collectMessageIds(
    gmail: gmail_v1.Gmail,
    maxResults: number,
  ): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await gmail.users.messages.list({
        userId: 'me',
        maxResults: Math.min(maxResults - ids.length, 500),
        pageToken,
      });
      for (const message of data.messages ?? []) {
        if (message.id) ids.push(message.id);
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken && ids.length < maxResults);
    return ids;
  }

  private async getMessageSummary(
    gmail: gmail_v1.Gmail,
    id: string,
  ): Promise<EmailSummary> {
    const { data } = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });
    const headers = data.payload?.headers ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? '';
    return {
      id: data.id ?? id,
      threadId: data.threadId ?? '',
      subject: header('Subject'),
      from: header('From'),
      date: header('Date'),
      snippet: data.snippet ?? '',
    };
  }

  private toApiError(error: unknown): GmailApiError {
    const kind = classifyGmailError(error);
    if (kind === 'unknown') {
      return {
        status: 'unknown',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return { status: kind };
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
