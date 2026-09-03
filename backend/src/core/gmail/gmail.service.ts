import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import {
  ConnectionService,
  ActiveAccount,
} from '../connection/connection.service.js';
import { classifyGmailError } from '../../common/helpers/gmail-error.js';
import { buildRawEmail } from '../../common/helpers/mime.js';

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

export interface EmailDetail extends EmailSummary {
  body: string;
  truncated: boolean;
}

export interface DraftSummary {
  id: string;
  messageId: string;
  threadId: string;
  to: string;
  subject: string;
  body: string;
}

export interface SentMessage {
  id: string;
  threadId: string;
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
    return this.listMessageSummaries(chatId, maxResults);
  }

  async searchEmails(
    chatId: string,
    query: string,
    maxResults = 20,
  ): Promise<GmailResult<EmailSummary[]>> {
    return this.listMessageSummaries(chatId, maxResults, query);
  }

  private async listMessageSummaries(
    chatId: string,
    maxResults: number,
    query?: string,
  ): Promise<GmailResult<EmailSummary[]>> {
    const client = await this.getClient(chatId);
    if (client.status !== 'active') return client;

    try {
      const ids = await this.collectMessageIds(client.gmail, maxResults, query);
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
    query?: string,
  ): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await gmail.users.messages.list({
        userId: 'me',
        maxResults: Math.min(maxResults - ids.length, 500),
        pageToken,
        q: query,
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
    return {
      id: data.id ?? id,
      threadId: data.threadId ?? '',
      subject: this.headerValue(data.payload?.headers, 'Subject'),
      from: this.headerValue(data.payload?.headers, 'From'),
      date: this.headerValue(data.payload?.headers, 'Date'),
      snippet: data.snippet ?? '',
    };
  }

  async getEmail(
    chatId: string,
    id: string,
    maxBodyLength = 4000,
  ): Promise<GmailResult<EmailDetail>> {
    const client = await this.getClient(chatId);
    if (client.status !== 'active') return client;

    try {
      const { data } = await client.gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      });
      const fullBody = this.extractBody(data.payload);
      const truncated = fullBody.length > maxBodyLength;
      return {
        status: 'ok',
        data: {
          id: data.id ?? id,
          threadId: data.threadId ?? '',
          subject: this.headerValue(data.payload?.headers, 'Subject'),
          from: this.headerValue(data.payload?.headers, 'From'),
          date: this.headerValue(data.payload?.headers, 'Date'),
          snippet: data.snippet ?? '',
          body: truncated ? fullBody.slice(0, maxBodyLength) : fullBody,
          truncated,
        },
      };
    } catch (error) {
      return this.toApiError(error);
    }
  }

  private headerValue(
    headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
    name: string,
  ): string {
    return (
      headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? ''
    );
  }

  // Prefers text/plain over text/html, depth-first across the MIME tree —
  // most real messages are multipart/alternative with both.
  private extractBody(part: gmail_v1.Schema$MessagePart | undefined): string {
    if (!part) return '';
    return (
      this.findPart(part, 'text/plain') ??
      this.findPart(part, 'text/html') ??
      ''
    );
  }

  private findPart(
    part: gmail_v1.Schema$MessagePart,
    mimeType: string,
  ): string | undefined {
    if (part.mimeType === mimeType && part.body?.data) {
      return Buffer.from(part.body.data, 'base64url').toString('utf-8');
    }
    for (const child of part.parts ?? []) {
      const found = this.findPart(child, mimeType);
      if (found) return found;
    }
    return undefined;
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

  async createDraft(
    chatId: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<GmailResult<DraftSummary>> {
    const client = await this.getClient(chatId);
    if (client.status !== 'active') return client;

    try {
      const raw = buildRawEmail({ to, subject, body });
      const { data } = await client.gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw } },
      });
      return {
        status: 'ok',
        data: this.draftSummaryFromInput(data, '', to, subject, body),
      };
    } catch (error) {
      return this.toApiError(error);
    }
  }

  async updateDraft(
    chatId: string,
    draftId: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<GmailResult<DraftSummary>> {
    const client = await this.getClient(chatId);
    if (client.status !== 'active') return client;

    try {
      const raw = buildRawEmail({ to, subject, body });
      const { data } = await client.gmail.users.drafts.update({
        userId: 'me',
        id: draftId,
        requestBody: { message: { raw } },
      });
      return {
        status: 'ok',
        data: this.draftSummaryFromInput(data, draftId, to, subject, body),
      };
    } catch (error) {
      return this.toApiError(error);
    }
  }

  async getDraft(
    chatId: string,
    draftId: string,
  ): Promise<GmailResult<DraftSummary>> {
    const client = await this.getClient(chatId);
    if (client.status !== 'active') return client;

    try {
      const summary = await this.getDraftSummaryById(client.gmail, draftId);
      return { status: 'ok', data: summary };
    } catch (error) {
      return this.toApiError(error);
    }
  }

  async listDrafts(
    chatId: string,
    maxResults = 20,
  ): Promise<GmailResult<DraftSummary[]>> {
    const client = await this.getClient(chatId);
    if (client.status !== 'active') return client;

    try {
      const ids = await this.collectDraftIds(client.gmail, maxResults);
      const drafts = await Promise.all(
        ids.map((id) => this.getDraftSummaryById(client.gmail, id)),
      );
      return { status: 'ok', data: drafts };
    } catch (error) {
      return this.toApiError(error);
    }
  }

  async sendDraft(
    chatId: string,
    draftId: string,
  ): Promise<GmailResult<SentMessage>> {
    const client = await this.getClient(chatId);
    if (client.status !== 'active') return client;

    try {
      const { data } = await client.gmail.users.drafts.send({
        userId: 'me',
        requestBody: { id: draftId },
      });
      return {
        status: 'ok',
        data: { id: data.id ?? '', threadId: data.threadId ?? '' },
      };
    } catch (error) {
      return this.toApiError(error);
    }
  }

  async deleteDraft(
    chatId: string,
    draftId: string,
  ): Promise<GmailResult<{ deleted: true }>> {
    const client = await this.getClient(chatId);
    if (client.status !== 'active') return client;

    try {
      await client.gmail.users.drafts.delete({ userId: 'me', id: draftId });
      return { status: 'ok', data: { deleted: true } };
    } catch (error) {
      const apiError = this.toApiError(error);
      // Already gone is success — deletion is idempotent.
      if (apiError.status === 'not_found') {
        return { status: 'ok', data: { deleted: true } };
      }
      return apiError;
    }
  }

  // Direct send — kept for future use, not exposed to any Telegram command
  // or agent tool. The agent's actual send path is createDraft + sendDraft.
  async sendEmail(
    chatId: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<GmailResult<SentMessage>> {
    const client = await this.getClient(chatId);
    if (client.status !== 'active') return client;

    try {
      const raw = buildRawEmail({ to, subject, body });
      const { data } = await client.gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });
      return {
        status: 'ok',
        data: { id: data.id ?? '', threadId: data.threadId ?? '' },
      };
    } catch (error) {
      return this.toApiError(error);
    }
  }

  private async collectDraftIds(
    gmail: gmail_v1.Gmail,
    maxResults: number,
  ): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await gmail.users.drafts.list({
        userId: 'me',
        maxResults: Math.min(maxResults - ids.length, 500),
        pageToken,
      });
      for (const draft of data.drafts ?? []) {
        if (draft.id) ids.push(draft.id);
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken && ids.length < maxResults);
    return ids;
  }

  private async getDraftSummaryById(
    gmail: gmail_v1.Gmail,
    id: string,
  ): Promise<DraftSummary> {
    const { data } = await gmail.users.drafts.get({
      userId: 'me',
      id,
      format: 'full',
    });
    return {
      id: data.id ?? id,
      messageId: data.message?.id ?? '',
      threadId: data.message?.threadId ?? '',
      to: this.headerValue(data.message?.payload?.headers, 'To'),
      subject: this.headerValue(data.message?.payload?.headers, 'Subject'),
      body: this.extractBody(data.message?.payload),
    };
  }

  // create/update don't reliably echo parsed headers back, so the summary
  // is built from what the caller sent rather than re-parsing the response.
  private draftSummaryFromInput(
    data: gmail_v1.Schema$Draft,
    fallbackId: string,
    to: string,
    subject: string,
    body: string,
  ): DraftSummary {
    return {
      id: data.id ?? fallbackId,
      messageId: data.message?.id ?? '',
      threadId: data.message?.threadId ?? '',
      to,
      subject,
      body,
    };
  }
}
