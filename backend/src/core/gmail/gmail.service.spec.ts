import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionService } from '../connection/connection.service.js';

const mockSetCredentials = jest.fn<any>();
const mockOn = jest.fn<any>();
const mockGmailFactory = jest.fn<any>();
const mockMessagesList = jest.fn<any>();
const mockMessagesGet = jest.fn<any>();
const mockMessagesSend = jest.fn<any>();
const mockDraftsCreate = jest.fn<any>();
const mockDraftsUpdate = jest.fn<any>();
const mockDraftsGet = jest.fn<any>();
const mockDraftsList = jest.fn<any>();
const mockDraftsSend = jest.fn<any>();
const mockDraftsDelete = jest.fn<any>();

class MockGaxiosError extends Error {
  status?: number;
  response?: { data?: unknown };
}

jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn<any>().mockImplementation(() => ({
        setCredentials: mockSetCredentials,
        on: mockOn,
      })),
    },
    gmail: mockGmailFactory,
  },
}));

type EmailSummary = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
};

type EmailDetail = EmailSummary & { body: string; truncated: boolean };

type DraftSummary = {
  id: string;
  messageId: string;
  threadId: string;
  to: string;
  subject: string;
  body: string;
};

type SentMessage = { id: string; threadId: string };

type GmailResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'none' }
  | { status: 'ambiguous'; accounts: unknown[] }
  | { status: 'needs_reconnect' }
  | { status: 'not_found' }
  | { status: 'rate_limited' }
  | { status: 'unknown'; message: string };

type GmailServiceInstance = {
  getClient(
    chatId: string,
  ): Promise<
    | { status: 'active'; gmail: unknown; account: { id: string } }
    | { status: 'none' }
    | { status: 'ambiguous'; accounts: unknown[] }
    | { status: 'needs_reconnect' }
  >;
  listEmails(
    chatId: string,
    maxResults?: number,
  ): Promise<GmailResult<EmailSummary[]>>;
  searchEmails(
    chatId: string,
    query: string,
    maxResults?: number,
  ): Promise<GmailResult<EmailSummary[]>>;
  getEmail(
    chatId: string,
    id: string,
    maxBodyLength?: number,
  ): Promise<GmailResult<EmailDetail>>;
  createDraft(
    chatId: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<GmailResult<DraftSummary>>;
  updateDraft(
    chatId: string,
    draftId: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<GmailResult<DraftSummary>>;
  getDraft(chatId: string, draftId: string): Promise<GmailResult<DraftSummary>>;
  listDrafts(
    chatId: string,
    maxResults?: number,
  ): Promise<GmailResult<DraftSummary[]>>;
  sendDraft(chatId: string, draftId: string): Promise<GmailResult<SentMessage>>;
  deleteDraft(
    chatId: string,
    draftId: string,
  ): Promise<GmailResult<{ deleted: true }>>;
  sendEmail(
    chatId: string,
    to: string,
    subject: string,
    body: string,
  ): Promise<GmailResult<SentMessage>>;
};

describe('GmailService', () => {
  let service: GmailServiceInstance;

  const mockConnectionService = {
    getActiveTokens: jest.fn<any>(),
    updateAccessToken: jest.fn<any>(),
  };

  const account = { id: 'conn-1', email: 'user@example.com' };

  function givenActiveConnection() {
    mockConnectionService.getActiveTokens.mockResolvedValue({
      status: 'active',
      account,
      tokens: {
        accessToken: 'the-access-token',
        refreshToken: 'the-refresh-token',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGmailFactory.mockReturnValue({
      users: {
        messages: {
          list: mockMessagesList,
          get: mockMessagesGet,
          send: mockMessagesSend,
        },
        drafts: {
          create: mockDraftsCreate,
          update: mockDraftsUpdate,
          get: mockDraftsGet,
          list: mockDraftsList,
          send: mockDraftsSend,
          delete: mockDraftsDelete,
        },
      },
    });

    const { GmailService } = await import('./gmail.service.js');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GmailService,
        { provide: ConnectionService, useValue: mockConnectionService },
      ],
    }).compile();

    service = module.get(GmailService);
  });

  it('passes through a "none" result untouched', async () => {
    mockConnectionService.getActiveTokens.mockResolvedValue({
      status: 'none',
    });

    const result = await service.getClient('chat-1');

    expect(result).toEqual({ status: 'none' });
    expect(mockSetCredentials).not.toHaveBeenCalled();
  });

  it('passes through an "ambiguous" result untouched', async () => {
    const accounts = [account, { id: 'conn-2', email: 'other@example.com' }];
    mockConnectionService.getActiveTokens.mockResolvedValue({
      status: 'ambiguous',
      accounts,
    });

    const result = await service.getClient('chat-1');

    expect(result).toEqual({ status: 'ambiguous', accounts });
  });

  it('returns needs_reconnect when there is no refresh token, instead of building a client that would throw later', async () => {
    mockConnectionService.getActiveTokens.mockResolvedValue({
      status: 'active',
      account,
      tokens: {
        accessToken: 'access-only',
        refreshToken: null,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const result = await service.getClient('chat-1');

    expect(result).toEqual({ status: 'needs_reconnect' });
    expect(mockSetCredentials).not.toHaveBeenCalled();
  });

  it('builds an authenticated client when active tokens include a refresh token', async () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    mockConnectionService.getActiveTokens.mockResolvedValue({
      status: 'active',
      account,
      tokens: {
        accessToken: 'the-access-token',
        refreshToken: 'the-refresh-token',
        expiresAt,
      },
    });

    const result = await service.getClient('chat-1');

    expect(mockSetCredentials).toHaveBeenCalledWith({
      access_token: 'the-access-token',
      refresh_token: 'the-refresh-token',
      expiry_date: expiresAt.getTime(),
    });
    expect(mockGmailFactory).toHaveBeenCalledWith(
      expect.objectContaining({ version: 'v1' }),
    );
    expect(result.status).toBe('active');
    if (result.status === 'active') {
      expect(result.account).toEqual(account);
    }
  });

  it('persists a refreshed access token via the tokens event', async () => {
    mockConnectionService.getActiveTokens.mockResolvedValue({
      status: 'active',
      account,
      tokens: {
        accessToken: 'old-access-token',
        refreshToken: 'the-refresh-token',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    mockConnectionService.updateAccessToken.mockResolvedValue(undefined);

    await service.getClient('chat-1');

    expect(mockOn).toHaveBeenCalledWith('tokens', expect.any(Function));
    const tokensHandler = mockOn.mock.calls[0][1] as (t: unknown) => void;

    const newExpiry = Date.now() + 7200_000;
    tokensHandler({ access_token: 'new-access-token', expiry_date: newExpiry });

    expect(mockConnectionService.updateAccessToken).toHaveBeenCalledWith(
      account.id,
      'new-access-token',
      expect.any(Date),
    );
    const expiresArg = mockConnectionService.updateAccessToken.mock
      .calls[0][2] as Date;
    expect(expiresArg.getTime()).toBe(newExpiry);
  });

  it('does not persist when the tokens event carries no access_token (e.g. a refresh_token-only rotation)', async () => {
    mockConnectionService.getActiveTokens.mockResolvedValue({
      status: 'active',
      account,
      tokens: {
        accessToken: 'old-access-token',
        refreshToken: 'the-refresh-token',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    await service.getClient('chat-1');

    const tokensHandler = mockOn.mock.calls[0][1] as (t: unknown) => void;
    tokensHandler({ refresh_token: 'rotated-refresh-token' });

    expect(mockConnectionService.updateAccessToken).not.toHaveBeenCalled();
  });

  describe('listEmails', () => {
    function summaryFor(id: string, subject: string) {
      return {
        data: {
          id,
          threadId: `thread-${id}`,
          snippet: `snippet-${id}`,
          payload: {
            headers: [
              { name: 'Subject', value: subject },
              { name: 'From', value: 'sender@example.com' },
              { name: 'Date', value: 'Wed, 1 Jan 2025 00:00:00 +0000' },
            ],
          },
        },
      };
    }

    it('passes through a non-active client status untouched', async () => {
      mockConnectionService.getActiveTokens.mockResolvedValue({
        status: 'none',
      });

      const result = await service.listEmails('chat-1');

      expect(result).toEqual({ status: 'none' });
      expect(mockMessagesList).not.toHaveBeenCalled();
    });

    it('merges two pages of results in order', async () => {
      givenActiveConnection();
      mockMessagesList
        .mockResolvedValueOnce({
          data: { messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'p2' },
        })
        .mockResolvedValueOnce({
          data: { messages: [{ id: 'm3' }] },
        });
      mockMessagesGet
        .mockResolvedValueOnce(summaryFor('m1', 'First'))
        .mockResolvedValueOnce(summaryFor('m2', 'Second'))
        .mockResolvedValueOnce(summaryFor('m3', 'Third'));

      const result = await service.listEmails('chat-1', 20);

      expect(mockMessagesList).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        status: 'ok',
        data: [
          expect.objectContaining({ id: 'm1', subject: 'First' }),
          expect.objectContaining({ id: 'm2', subject: 'Second' }),
          expect.objectContaining({ id: 'm3', subject: 'Third' }),
        ],
      });
    });

    it('respects maxResults and does not fetch a further page once satisfied', async () => {
      givenActiveConnection();
      mockMessagesList.mockResolvedValueOnce({
        data: { messages: [{ id: 'm1' }], nextPageToken: 'p2' },
      });
      mockMessagesGet.mockResolvedValueOnce(summaryFor('m1', 'Only'));

      const result = await service.listEmails('chat-1', 1);

      expect(mockMessagesList).toHaveBeenCalledTimes(1);
      expect(mockMessagesList).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 1 }),
      );
      expect(result).toEqual({
        status: 'ok',
        data: [expect.objectContaining({ id: 'm1' })],
      });
    });

    it('maps a rate-limit failure to a typed result instead of throwing', async () => {
      givenActiveConnection();
      const error = new MockGaxiosError('Too many requests');
      error.status = 429;
      mockMessagesList.mockRejectedValue(error);

      const result = await service.listEmails('chat-1');

      expect(result).toEqual({ status: 'rate_limited' });
    });
  });

  describe('getEmail', () => {
    function b64(text: string) {
      return Buffer.from(text).toString('base64url');
    }

    it('passes through a non-active client status untouched', async () => {
      mockConnectionService.getActiveTokens.mockResolvedValue({
        status: 'none',
      });

      const result = await service.getEmail('chat-1', 'm1');

      expect(result).toEqual({ status: 'none' });
      expect(mockMessagesGet).not.toHaveBeenCalled();
    });

    it('prefers text/plain over text/html in a multipart/alternative message', async () => {
      givenActiveConnection();
      mockMessagesGet.mockResolvedValue({
        data: {
          id: 'm1',
          threadId: 't1',
          snippet: 'preview',
          payload: {
            headers: [
              { name: 'Subject', value: 'Hello' },
              { name: 'From', value: 'a@x.com' },
              { name: 'Date', value: 'Wed, 1 Jan 2025 00:00:00 +0000' },
            ],
            mimeType: 'multipart/alternative',
            parts: [
              {
                mimeType: 'text/html',
                body: { data: b64('<p>Hello HTML</p>') },
              },
              {
                mimeType: 'text/plain',
                body: { data: b64('Hello plain text') },
              },
            ],
          },
        },
      });

      const result = await service.getEmail('chat-1', 'm1');

      expect(result).toEqual({
        status: 'ok',
        data: expect.objectContaining({
          body: 'Hello plain text',
          truncated: false,
        }),
      });
    });

    it('falls back to text/html when no text/plain part exists', async () => {
      givenActiveConnection();
      mockMessagesGet.mockResolvedValue({
        data: {
          id: 'm1',
          threadId: 't1',
          payload: {
            headers: [],
            mimeType: 'text/html',
            body: { data: b64('<p>Only HTML</p>') },
          },
        },
      });

      const result = await service.getEmail('chat-1', 'm1');

      expect(result).toEqual({
        status: 'ok',
        data: expect.objectContaining({ body: '<p>Only HTML</p>' }),
      });
    });

    it('truncates a body longer than maxBodyLength and flags it', async () => {
      givenActiveConnection();
      const longBody = 'x'.repeat(50);
      mockMessagesGet.mockResolvedValue({
        data: {
          id: 'm1',
          threadId: 't1',
          payload: {
            headers: [],
            mimeType: 'text/plain',
            body: { data: b64(longBody) },
          },
        },
      });

      const result = await service.getEmail('chat-1', 'm1', 10);

      expect(result).toEqual({
        status: 'ok',
        data: expect.objectContaining({
          body: 'x'.repeat(10),
          truncated: true,
        }),
      });
    });

    it('maps a 404 to not_found instead of throwing', async () => {
      givenActiveConnection();
      const error = new MockGaxiosError('Not Found');
      error.status = 404;
      mockMessagesGet.mockRejectedValue(error);

      const result = await service.getEmail('chat-1', 'missing');

      expect(result).toEqual({ status: 'not_found' });
    });
  });

  describe('searchEmails', () => {
    it('forwards the query to messages.list verbatim, untouched by our own parsing', async () => {
      givenActiveConnection();
      mockMessagesList.mockResolvedValue({ data: { messages: [] } });

      await service.searchEmails(
        'chat-1',
        'from:boss@x.com is:unread after:2025/01/01',
      );

      expect(mockMessagesList).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'from:boss@x.com is:unread after:2025/01/01',
        }),
      );
    });

    it('passes through a non-active client status untouched', async () => {
      mockConnectionService.getActiveTokens.mockResolvedValue({
        status: 'none',
      });

      const result = await service.searchEmails('chat-1', 'is:unread');

      expect(result).toEqual({ status: 'none' });
      expect(mockMessagesList).not.toHaveBeenCalled();
    });
  });

  function decodeRaw(raw: string): string {
    return Buffer.from(raw, 'base64url').toString('utf-8');
  }

  describe('createDraft', () => {
    it('builds a MIME message and returns a summary built from the input', async () => {
      givenActiveConnection();
      mockDraftsCreate.mockResolvedValue({
        data: { id: 'd1', message: { id: 'm1', threadId: 't1' } },
      });

      const result = await service.createDraft(
        'chat-1',
        'to@x.com',
        'Subject',
        'Body text',
      );

      const call = mockDraftsCreate.mock.calls[0][0] as {
        requestBody: { message: { raw: string } };
      };
      const decoded = decodeRaw(call.requestBody.message.raw);
      expect(decoded).toContain('To: to@x.com');
      expect(decoded).toContain('Subject: Subject');
      expect(decoded).toContain('Body text');

      expect(result).toEqual({
        status: 'ok',
        data: {
          id: 'd1',
          messageId: 'm1',
          threadId: 't1',
          to: 'to@x.com',
          subject: 'Subject',
          body: 'Body text',
        },
      });
    });

    it('passes through a non-active client status untouched', async () => {
      mockConnectionService.getActiveTokens.mockResolvedValue({
        status: 'none',
      });

      const result = await service.createDraft('chat-1', 'to@x.com', 'S', 'B');

      expect(result).toEqual({ status: 'none' });
      expect(mockDraftsCreate).not.toHaveBeenCalled();
    });

    it('maps insufficient-permissions (stale pre-compose-scope grant) to needs_reconnect', async () => {
      givenActiveConnection();
      const error = new MockGaxiosError('Forbidden');
      error.status = 403;
      error.response = {
        data: { error: { errors: [{ reason: 'insufficientPermissions' }] } },
      };
      mockDraftsCreate.mockRejectedValue(error);

      const result = await service.createDraft('chat-1', 'to@x.com', 'S', 'B');

      expect(result).toEqual({ status: 'needs_reconnect' });
    });
  });

  describe('updateDraft', () => {
    it('rebuilds the MIME message and returns a summary reflecting the new content', async () => {
      givenActiveConnection();
      mockDraftsUpdate.mockResolvedValue({
        data: { id: 'd1', message: { id: 'm2', threadId: 't1' } },
      });

      const result = await service.updateDraft(
        'chat-1',
        'd1',
        'to@x.com',
        'New subject',
        'New body',
      );

      expect(mockDraftsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd1' }),
      );
      expect(result).toEqual({
        status: 'ok',
        data: {
          id: 'd1',
          messageId: 'm2',
          threadId: 't1',
          to: 'to@x.com',
          subject: 'New subject',
          body: 'New body',
        },
      });
    });
  });

  describe('getDraft', () => {
    function b64(text: string) {
      return Buffer.from(text).toString('base64url');
    }

    it('decodes the draft message into a DraftSummary', async () => {
      givenActiveConnection();
      mockDraftsGet.mockResolvedValue({
        data: {
          id: 'd1',
          message: {
            id: 'm1',
            threadId: 't1',
            payload: {
              headers: [
                { name: 'To', value: 'to@x.com' },
                { name: 'Subject', value: 'Hello' },
              ],
              mimeType: 'text/plain',
              body: { data: b64('Draft body') },
            },
          },
        },
      });

      const result = await service.getDraft('chat-1', 'd1');

      expect(mockDraftsGet).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd1', format: 'full' }),
      );
      expect(result).toEqual({
        status: 'ok',
        data: {
          id: 'd1',
          messageId: 'm1',
          threadId: 't1',
          to: 'to@x.com',
          subject: 'Hello',
          body: 'Draft body',
        },
      });
    });

    it('passes through a non-active client status untouched', async () => {
      mockConnectionService.getActiveTokens.mockResolvedValue({
        status: 'none',
      });

      const result = await service.getDraft('chat-1', 'd1');

      expect(result).toEqual({ status: 'none' });
      expect(mockDraftsGet).not.toHaveBeenCalled();
    });
  });

  describe('listDrafts', () => {
    function b64(text: string) {
      return Buffer.from(text).toString('base64url');
    }

    function draftFor(id: string, subject: string) {
      return {
        data: {
          id,
          message: {
            id: `msg-${id}`,
            threadId: `thread-${id}`,
            payload: {
              headers: [{ name: 'Subject', value: subject }],
              mimeType: 'text/plain',
              body: { data: b64(`body-${id}`) },
            },
          },
        },
      };
    }

    it('paginates drafts.list then fetches each full draft, merging in order', async () => {
      givenActiveConnection();
      mockDraftsList
        .mockResolvedValueOnce({
          data: { drafts: [{ id: 'd1' }, { id: 'd2' }], nextPageToken: 'p2' },
        })
        .mockResolvedValueOnce({ data: { drafts: [{ id: 'd3' }] } });
      mockDraftsGet
        .mockResolvedValueOnce(draftFor('d1', 'First'))
        .mockResolvedValueOnce(draftFor('d2', 'Second'))
        .mockResolvedValueOnce(draftFor('d3', 'Third'));

      const result = await service.listDrafts('chat-1', 20);

      expect(mockDraftsList).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        status: 'ok',
        data: [
          expect.objectContaining({ id: 'd1', subject: 'First' }),
          expect.objectContaining({ id: 'd2', subject: 'Second' }),
          expect.objectContaining({ id: 'd3', subject: 'Third' }),
        ],
      });
    });
  });

  describe('sendDraft', () => {
    it('sends by draft id, not by re-encoding the message', async () => {
      givenActiveConnection();
      mockDraftsSend.mockResolvedValue({
        data: { id: 'sent-1', threadId: 't1' },
      });

      const result = await service.sendDraft('chat-1', 'd1');

      expect(mockDraftsSend).toHaveBeenCalledWith(
        expect.objectContaining({ requestBody: { id: 'd1' } }),
      );
      expect(result).toEqual({
        status: 'ok',
        data: { id: 'sent-1', threadId: 't1' },
      });
    });

    it('does not retry or resend on failure', async () => {
      givenActiveConnection();
      const error = new MockGaxiosError('Internal Server Error');
      error.status = 500;
      mockDraftsSend.mockRejectedValue(error);

      const result = await service.sendDraft('chat-1', 'd1');

      expect(mockDraftsSend).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: 'rate_limited' });
    });
  });

  describe('deleteDraft', () => {
    it('returns deleted:true on success', async () => {
      givenActiveConnection();
      mockDraftsDelete.mockResolvedValue({});

      const result = await service.deleteDraft('chat-1', 'd1');

      expect(result).toEqual({ status: 'ok', data: { deleted: true } });
    });

    it('treats a 404 (already deleted) as an idempotent success', async () => {
      givenActiveConnection();
      const error = new MockGaxiosError('Not Found');
      error.status = 404;
      mockDraftsDelete.mockRejectedValue(error);

      const result = await service.deleteDraft('chat-1', 'd1');

      expect(result).toEqual({ status: 'ok', data: { deleted: true } });
    });

    it('does not swallow a non-404 error', async () => {
      givenActiveConnection();
      const error = new MockGaxiosError('Unauthorized');
      error.status = 401;
      mockDraftsDelete.mockRejectedValue(error);

      const result = await service.deleteDraft('chat-1', 'd1');

      expect(result).toEqual({ status: 'needs_reconnect' });
    });
  });

  describe('sendEmail (direct)', () => {
    it('builds a MIME message and sends it via messages.send', async () => {
      givenActiveConnection();
      mockMessagesSend.mockResolvedValue({
        data: { id: 'sent-1', threadId: 't1' },
      });

      const result = await service.sendEmail(
        'chat-1',
        'to@x.com',
        'Subject',
        'Body',
      );

      const call = mockMessagesSend.mock.calls[0][0] as {
        requestBody: { raw: string };
      };
      const decoded = decodeRaw(call.requestBody.raw);
      expect(decoded).toContain('To: to@x.com');
      expect(result).toEqual({
        status: 'ok',
        data: { id: 'sent-1', threadId: 't1' },
      });
    });
  });
});
