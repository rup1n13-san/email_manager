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
          // error, not warn: the in-flight call still succeeds with the new
          // token in memory, but the DB now holds a stale one — every later
          // call re-triggers a refresh against Google until this is fixed.
          this.logger.error(
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

  // Shared skeleton for every public method: resolve the client, pass
  // through a non-active status untouched, map a thrown API error to a
  // typed result. Callers that need special error handling (e.g.
  // deleteDraft's 404-is-success) catch inside their own `fn` instead.
  private async withGmailClient<T>(
    chatId: string,
    fn: (gmail: gmail_v1.Gmail) => Promise<T>,
  ): Promise<GmailResult<T>> {
    const client = await this.getClient(chatId);
    if (client.status !== 'active') return client;

    try {
      const data = await fn(client.gmail);
      return { status: 'ok', data };
    } catch (error) {
      return this.toApiError(error);
    }
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

  // One cursor-pagination loop shared by every Gmail list endpoint
  // (messages, drafts) — they differ only in which resource is called and
  // which field holds the id.
  private async paginateIds<Item>(
    fetchPage: (
      pageToken: string | undefined,
      pageSize: number,
    ) => Promise<{ items: Item[]; nextPageToken?: string }>,
    getId: (item: Item) => string | null | undefined,
    maxResults: number,
  ): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const { items, nextPageToken } = await fetchPage(
        pageToken,
        Math.min(maxResults - ids.length, 500),
      );
      for (const item of items) {
        const id = getId(item);
        if (id) ids.push(id);
      }
      pageToken = nextPageToken;
    } while (pageToken && ids.length < maxResults);
    return ids;
  }

  async listEmails(
    chatId: string,
    maxResults = 20,
  ): Promise<GmailResult<EmailSummary[]>> {
    return this.withGmailClient(chatId, (gmail) =>
      this.listMessageSummaries(gmail, maxResults),
    );
  }

  async searchEmails(
    chatId: string,
    query: string,
    maxResults = 20,
  ): Promise<GmailResult<EmailSummary[]>> {
    return this.withGmailClient(chatId, (gmail) =>
      this.listMessageSummaries(gmail, maxResults, query),
    );
  }

  private async listMessageSummaries(
    gmail: gmail_v1.Gmail,
    maxResults: number,
    query?: string,
  ): Promise<EmailSummary[]> {
    const ids = await this.collectMessageIds(gmail, maxResults, query);
    const summaries: EmailSummary[] = [];
    for (const id of ids) {
      summaries.push(await this.getMessageSummary(gmail, id));
    }

    return summaries;
  }

  private async collectMessageIds(
    gmail: gmail_v1.Gmail,
    maxResults: number,
    query?: string,
  ): Promise<string[]> {
    return this.paginateIds(
      async (pageToken, pageSize) => {
        const { data } = await gmail.users.messages.list({
          userId: 'me',
          maxResults: pageSize,
          pageToken,
          q: query,
        });
        return {
          items: data.messages ?? [],
          nextPageToken: data.nextPageToken ?? undefined,
        };
      },
      (message) => message.id,
      maxResults,
    );
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
    return this.withGmailClient(chatId, async (gmail) => {
      const { data } = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      });
      const fullBody = this.extractBody(data.payload);
      const truncated = fullBody.length > maxBodyLength;
      return {
        id: data.id ?? id,
        threadId: data.threadId ?? '',
        subject: this.headerValue(data.payload?.headers, 'Subject'),
        from: this.headerValue(data.payload?.headers, 'From'),
        date: this.headerValue(data.payload?.headers, 'Date'),
        snippet: data.snippet ?? '',
        body: truncated
          ? this.truncateOnCodePointBoundary(fullBody, maxBodyLength)
          : fullBody,
        truncated,
      };
    });
  }

  // A plain slice() can land between a surrogate pair's two UTF-16 units
  // (an emoji, some CJK), leaving a dangling unpaired surrogate. Back off
  // one unit when the cut point is a high surrogate.
  private truncateOnCodePointBoundary(text: string, maxLength: number): string {
    let end = maxLength;
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    return text.slice(0, end);
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

  async createDraft(
    chatId: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<GmailResult<DraftSummary>> {
    return this.withGmailClient(chatId, async (gmail) => {
      const raw = buildRawEmail({ to, subject, body });
      const { data } = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw } },
      });
      return this.draftSummaryFromInput(data, '', to, subject, body);
    });
  }

  async updateDraft(
    chatId: string,
    draftId: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<GmailResult<DraftSummary>> {
    return this.withGmailClient(chatId, async (gmail) => {
      const raw = buildRawEmail({ to, subject, body });
      const { data } = await gmail.users.drafts.update({
        userId: 'me',
        id: draftId,
        requestBody: { message: { raw } },
      });
      return this.draftSummaryFromInput(data, draftId, to, subject, body);
    });
  }

  async getDraft(
    chatId: string,
    draftId: string,
  ): Promise<GmailResult<DraftSummary>> {
    return this.withGmailClient(chatId, (gmail) =>
      this.getDraftSummaryById(gmail, draftId),
    );
  }

  async listDrafts(
    chatId: string,
    maxResults = 20,
  ): Promise<GmailResult<DraftSummary[]>> {
    return this.withGmailClient(chatId, async (gmail) => {
      const ids = await this.collectDraftIds(gmail, maxResults);
      return Promise.all(ids.map((id) => this.getDraftSummaryById(gmail, id)));
    });
  }

  private async collectDraftIds(
    gmail: gmail_v1.Gmail,
    maxResults: number,
  ): Promise<string[]> {
    return this.paginateIds(
      async (pageToken, pageSize) => {
        const { data } = await gmail.users.drafts.list({
          userId: 'me',
          maxResults: pageSize,
          pageToken,
        });
        return {
          items: data.drafts ?? [],
          nextPageToken: data.nextPageToken ?? undefined,
        };
      },
      (draft) => draft.id,
      maxResults,
    );
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

  async sendDraft(
    chatId: string,
    draftId: string,
  ): Promise<GmailResult<SentMessage>> {
    return this.withGmailClient(chatId, async (gmail) => {
      const { data } = await gmail.users.drafts.send({
        userId: 'me',
        requestBody: { id: draftId },
      });
      return { id: data.id ?? '', threadId: data.threadId ?? '' };
    });
  }

  async deleteDraft(
    chatId: string,
    draftId: string,
  ): Promise<GmailResult<{ deleted: true }>> {
    return this.withGmailClient(chatId, async (gmail) => {
      try {
        await gmail.users.drafts.delete({ userId: 'me', id: draftId });
      } catch (error) {
        // Already gone is success — deletion is idempotent. Any other
        // error rethrows to withGmailClient's own catch.
        if (classifyGmailError(error) !== 'not_found') throw error;
      }
      return { deleted: true } as const;
    });
  }

  // Direct send — kept for future use, not exposed to any Telegram command
  // or agent tool. The agent's actual send path is createDraft + sendDraft.
  async sendEmail(
    chatId: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<GmailResult<SentMessage>> {
    return this.withGmailClient(chatId, async (gmail) => {
      const raw = buildRawEmail({ to, subject, body });
      const { data } = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });
      return { id: data.id ?? '', threadId: data.threadId ?? '' };
    });
  }
}
