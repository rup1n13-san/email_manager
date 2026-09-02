import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TelegramService } from './telegram.service.js';
import { UserService } from '../user/user.service.js';
import { ConnectionService } from '../connection/connection.service.js';
import { decodeOAuthState } from '../../common/helpers/oauth-state.js';

const BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
const CHAT_ID = '98765';
const ENCRYPTION_KEY =
  '0992b7c6d936d9071b4e285b1794cf935a2b5a5a163c7ef1dc21c31c572960e7';

function mockFetch(response: Partial<Response>) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(response as Response);
}

interface FetchCallArgs {
  body: string;
}

const mockUserWithRelations = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  telegramChatId: CHAT_ID,
  activeConnectionId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  settings: null,
  connections: [],
};

function makeUpdate(overrides: Record<string, unknown> = {}) {
  return {
    update_id: 1,
    message: {
      message_id: 100,
      from: {
        id: 12345,
        is_bot: false,
        first_name: 'Test',
        username: 'testuser',
      },
      chat: { id: 98765, type: 'private' },
      date: 1700000000,
      text: '/start',
      entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      ...overrides,
    },
  };
}

async function createService(): Promise<{
  service: TelegramService;
  userService: UserService;
  connectionService: ConnectionService;
}> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TelegramService,
      {
        provide: UserService,
        useValue: {
          findByChatId: jest.fn<any>(),
          create: jest.fn<any>(),
        },
      },
      {
        provide: ConnectionService,
        useValue: {
          listConnections: jest.fn<any>(),
          getActive: jest.fn<any>(() => Promise.resolve({ status: 'none' })),
          setActive: jest.fn<any>(),
          disconnect: jest.fn<any>(),
          confirmConnection: jest.fn<any>(),
          rejectConnection: jest.fn<any>(),
        },
      },
    ],
  }).compile();

  return {
    service: module.get<TelegramService>(TelegramService),
    userService: module.get<UserService>(UserService),
    connectionService: module.get<ConnectionService>(ConnectionService),
  };
}

describe('TelegramService', () => {
  let originalToken: string | undefined;
  let originalClientId: string | undefined;
  let originalRedirectUri: string | undefined;
  let originalEncryptionKey: string | undefined;

  beforeAll(() => {
    originalToken = process.env.TELEGRAM_BOT_TOKEN;
    originalClientId = process.env.GOOGLE_CLIENT_ID;
    originalRedirectUri = process.env.GOOGLE_REDIRECT_URI;
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  });

  afterAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
    process.env.GOOGLE_CLIENT_ID = originalClientId;
    process.env.GOOGLE_REDIRECT_URI = originalRedirectUri;
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  describe('sendMessage', () => {
    it('sends a message and returns ok=true on success', async () => {
      const { service } = await createService();
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      });

      const result = await service.sendMessage(CHAT_ID, 'Hello');

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: CHAT_ID, text: 'Hello' }),
        },
      );
    });

    it('includes parse_mode when provided', async () => {
      const { service } = await createService();
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      });

      await service.sendMessage(CHAT_ID, '*bold*', {
        parseMode: 'MarkdownV2',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          body: expect.stringContaining('"parse_mode":"MarkdownV2"'),
        }),
      );
    });

    it('retries without parseMode on 400 error', async () => {
      const { service } = await createService();
      const fetchMock = jest.spyOn(globalThis, 'fetch');
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: () => Promise.resolve('Bad Request: cant parse entities'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true }),
        } as Response);

      const result = await service.sendMessage(CHAT_ID, '*bad markdown*', {
        parseMode: 'MarkdownV2',
      });

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const secondCall = fetchMock.mock.calls[1] as unknown as [
        string,
        FetchCallArgs,
      ];
      const secondBody = JSON.parse(secondCall[1].body) as Record<
        string,
        unknown
      >;
      expect(secondBody.parse_mode).toBeUndefined();
    });

    it('does NOT retry on 429 — rate limits must surface, not look like a parse error', async () => {
      const { service } = await createService();
      const fetchMock = mockFetch({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Too Many Requests: retry later'),
      });

      await expect(
        service.sendMessage(CHAT_ID, 'hi', { parseMode: 'MarkdownV2' }),
      ).rejects.toThrow('Telegram API error 429');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 500', async () => {
      const { service } = await createService();
      const fetchMock = mockFetch({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(
        service.sendMessage(CHAT_ID, 'hi', { parseMode: 'MarkdownV2' }),
      ).rejects.toThrow('Telegram API error 500');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('passes reply_markup through when provided', async () => {
      const { service } = await createService();
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      });

      await service.sendMessage(CHAT_ID, 'pick one', {
        replyMarkup: {
          inline_keyboard: [[{ text: 'Confirm', callback_data: 'c:1' }]],
        },
      });

      const call = fetchMock.mock.calls[0] as unknown as [
        string,
        FetchCallArgs,
      ];
      expect(call[1].body).toContain('"reply_markup"');
      expect(call[1].body).toContain('"callback_data":"c:1"');
    });

    it('throws when TELEGRAM_BOT_TOKEN is missing', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      const { service } = await createService();

      await expect(service.sendMessage(CHAT_ID, 'test')).rejects.toThrow(
        'TELEGRAM_BOT_TOKEN is not set',
      );
    });

    it('throws on API error without parseMode', async () => {
      const { service } = await createService();
      mockFetch({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden: bot was blocked by the user'),
      });

      await expect(service.sendMessage(CHAT_ID, 'test')).rejects.toThrow(
        'Telegram API error 403: Forbidden: bot was blocked by the user',
      );
    });
  });

  describe('sendTyping', () => {
    it('sends typing action successfully', async () => {
      const { service } = await createService();
      const fetchMock = mockFetch({
        ok: true,
        status: 200,
      });

      await service.sendTyping(CHAT_ID);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: CHAT_ID, action: 'typing' }),
        },
      );
    });

    it('throws when TELEGRAM_BOT_TOKEN is missing', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      const { service } = await createService();

      await expect(service.sendTyping(CHAT_ID)).rejects.toThrow(
        'TELEGRAM_BOT_TOKEN is not set',
      );
    });

    it('throws on API error', async () => {
      const { service } = await createService();
      mockFetch({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Too Many Requests: retry later'),
      });

      await expect(service.sendTyping(CHAT_ID)).rejects.toThrow(
        'Telegram API error 429: Too Many Requests: retry later',
      );
    });
  });

  describe('processUpdate (command handler)', () => {
    describe('/start', () => {
      it('creates a new user and sends welcome for first-time user', async () => {
        const { service, userService } = await createService();
        jest.spyOn(userService, 'findByChatId').mockResolvedValue(null);
        jest.spyOn(userService, 'create').mockResolvedValue({
          id: 'new-id',
          telegramChatId: '98765',
          createdAt: new Date(),
          updatedAt: new Date(),
          preference: null,
          connections: [],
        } as never);
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate(makeUpdate());

        expect(result).toEqual({ ok: true });
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(userService.findByChatId).toHaveBeenCalledWith('98765');
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(userService.create).toHaveBeenCalledWith('98765');
        expect(sendSpy).toHaveBeenCalledWith(
          '98765',
          expect.stringContaining('Welcome, Test'),
        );
      });

      it('sends welcome back for existing user without creating', async () => {
        const { service, userService } = await createService();
        jest.spyOn(userService, 'findByChatId').mockResolvedValue({
          id: 'existing-id',
          telegramChatId: '98765',
          createdAt: new Date(),
          updatedAt: new Date(),
          preference: null,
          connections: [],
        } as never);
        const createSpy = jest.spyOn(userService, 'create');
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate(makeUpdate());

        expect(result).toEqual({ ok: true });
        expect(createSpy).not.toHaveBeenCalled();
        expect(sendSpy).toHaveBeenCalledWith(
          '98765',
          expect.stringContaining('Welcome back'),
        );
      });
    });

    describe('/help', () => {
      it('sends the help message', async () => {
        const { service } = await createService();
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate(
          makeUpdate({
            text: '/help',
            entities: [{ type: 'bot_command', offset: 0, length: 5 }],
          }),
        );

        expect(result).toEqual({ ok: true });
        expect(sendSpy).toHaveBeenCalledWith(
          '98765',
          expect.stringContaining('I can help you manage your Gmail'),
        );
        expect(sendSpy).toHaveBeenCalledWith(
          '98765',
          expect.stringContaining('/list'),
        );
      });
    });

    describe('/connect', () => {
      it('sends the Google OAuth URL to the user', async () => {
        const { service } = await createService();
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate(
          makeUpdate({
            text: '/connect',
            entities: [{ type: 'bot_command', offset: 0, length: 8 }],
          }),
        );

        expect(result).toEqual({ ok: true });
        expect(sendSpy).toHaveBeenCalledWith(
          '98765',
          expect.stringContaining('accounts.google.com'),
        );
      });

      it('URL state parameter decodes back to the chatId', async () => {
        const { service } = await createService();
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        await service.processUpdate(
          makeUpdate({
            text: '/connect',
            entities: [{ type: 'bot_command', offset: 0, length: 8 }],
          }),
        );

        const message = sendSpy.mock.calls[0][1];
        const url = new URL(message.match(/https:\S+/)![0]);
        const state = url.searchParams.get('state')!;
        expect(decodeOAuthState(state, 'GOOGLE')).toEqual({ chatId: '98765' });
      });

      it('sends error message when OAuth config is missing', async () => {
        delete process.env.GOOGLE_CLIENT_ID;
        const { service } = await createService();
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate(
          makeUpdate({
            text: '/connect',
            entities: [{ type: 'bot_command', offset: 0, length: 8 }],
          }),
        );

        expect(result).toEqual({ ok: true });
        expect(sendSpy).toHaveBeenCalledWith(
          '98765',
          expect.stringContaining('not configured'),
        );
        process.env.GOOGLE_CLIENT_ID =
          'test-client-id.apps.googleusercontent.com';
      });
    });

    describe('/list', () => {
      it('sends the empty-state message when no connections exist', async () => {
        const { service, connectionService } = await createService();
        jest.spyOn(connectionService, 'listConnections').mockResolvedValue([]);
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate(
          makeUpdate({
            text: '/list',
            entities: [{ type: 'bot_command', offset: 0, length: 5 }],
          }),
        );

        expect(result).toEqual({ ok: true });
        expect(sendSpy).toHaveBeenCalledWith(
          '98765',
          expect.stringContaining("don't have any connected"),
        );
      });

      it('lists a single connected account', async () => {
        const { service, connectionService } = await createService();
        jest
          .spyOn(connectionService, 'listConnections')
          .mockResolvedValue([
            { email: 'a@x.com', providerAccountId: 'gid-1' },
          ]);
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        await service.processUpdate(
          makeUpdate({
            text: '/list',
            entities: [{ type: 'bot_command', offset: 0, length: 5 }],
          }),
        );

        const message = sendSpy.mock.calls[0][1];
        expect(message).toContain('1. a@x.com');
        expect(message).toContain('Use /disconnect to remove it.');
      });

      it('lists multiple connected accounts', async () => {
        const { service, connectionService } = await createService();
        jest.spyOn(connectionService, 'listConnections').mockResolvedValue([
          { email: 'a@x.com', providerAccountId: 'gid-1' },
          { email: 'b@x.com', providerAccountId: 'gid-2' },
        ]);
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        await service.processUpdate(
          makeUpdate({
            text: '/list',
            entities: [{ type: 'bot_command', offset: 0, length: 5 }],
          }),
        );

        const message = sendSpy.mock.calls[0][1];
        expect(message).toContain('1. a@x.com');
        expect(message).toContain('2. b@x.com');
        expect(message).toContain('Use /disconnect <email> to remove one.');
      });

      it('marks the active account and offers /switch', async () => {
        const { service, connectionService } = await createService();
        jest.spyOn(connectionService, 'listConnections').mockResolvedValue([
          { email: 'a@x.com', providerAccountId: 'gid-1' },
          { email: 'b@x.com', providerAccountId: 'gid-2' },
        ]);
        jest.spyOn(connectionService, 'getActive').mockResolvedValue({
          status: 'active',
          account: { id: 'c2', email: 'b@x.com', providerAccountId: 'gid-2' },
        });
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        await service.processUpdate(
          makeUpdate({
            text: '/list',
            entities: [{ type: 'bot_command', offset: 0, length: 5 }],
          }),
        );

        const message = sendSpy.mock.calls[0][1];
        expect(message).toContain('1. a@x.com\n');
        expect(message).toContain('2. b@x.com  (active)');
        expect(message).toContain('Use /switch <email> to change');
      });

      it('says no account is active yet when the pointer is unset', async () => {
        const { service, connectionService } = await createService();
        jest.spyOn(connectionService, 'listConnections').mockResolvedValue([
          { email: 'a@x.com', providerAccountId: 'gid-1' },
          { email: 'b@x.com', providerAccountId: 'gid-2' },
        ]);
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        await service.processUpdate(
          makeUpdate({
            text: '/list',
            entities: [{ type: 'bot_command', offset: 0, length: 5 }],
          }),
        );

        const message = sendSpy.mock.calls[0][1];
        expect(message).not.toContain('(active)');
        expect(message).toContain('No active account yet');
      });
    });

    describe('/switch', () => {
      const switchUpdate = (text: string) =>
        makeUpdate({
          text,
          entities: [{ type: 'bot_command', offset: 0, length: 7 }],
        });

      it('confirms the account it switched to', async () => {
        const { service, connectionService } = await createService();
        const setActiveSpy = jest
          .spyOn(connectionService, 'setActive')
          .mockResolvedValue({ status: 'switched', email: 'b@x.com' });
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate(
          switchUpdate('/switch b@x.com'),
        );

        expect(result).toEqual({ ok: true });
        expect(setActiveSpy).toHaveBeenCalledWith('98765', 'b@x.com');
        expect(sendSpy).toHaveBeenCalledWith('98765', 'Now using b@x.com.');
      });

      it('passes no email through when called bare', async () => {
        const { service, connectionService } = await createService();
        const setActiveSpy = jest
          .spyOn(connectionService, 'setActive')
          .mockResolvedValue({ status: 'switched', email: 'a@x.com' });
        jest.spyOn(service, 'sendMessage').mockResolvedValue({ ok: true });

        await service.processUpdate(switchUpdate('/switch'));

        expect(setActiveSpy).toHaveBeenCalledWith('98765', undefined);
      });

      it('lists the accounts to choose from when the request is ambiguous', async () => {
        const { service, connectionService } = await createService();
        jest.spyOn(connectionService, 'setActive').mockResolvedValue({
          status: 'ambiguous',
          accounts: [
            { id: 'c1', email: 'a@x.com', providerAccountId: 'gid-1' },
            { id: 'c2', email: 'b@x.com', providerAccountId: 'gid-2' },
          ],
        });
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        await service.processUpdate(switchUpdate('/switch'));

        const message = sendSpy.mock.calls[0][1];
        expect(message).toContain('- a@x.com');
        expect(message).toContain('- b@x.com');
        expect(message).toContain('Reply with /switch <email>');
      });

      it('relays a NotFoundException as a plain chat message', async () => {
        const { service, connectionService } = await createService();
        jest
          .spyOn(connectionService, 'setActive')
          .mockRejectedValue(
            new NotFoundException('No connected account found for z@x.com.'),
          );
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate(
          switchUpdate('/switch z@x.com'),
        );

        expect(result).toEqual({ ok: true });
        expect(sendSpy).toHaveBeenCalledWith(
          '98765',
          'No connected account found for z@x.com.',
        );
      });
    });

    describe('/disconnect', () => {
      it('relays the "no connections" message', async () => {
        const { service, connectionService } = await createService();
        jest
          .spyOn(connectionService, 'disconnect')
          .mockRejectedValue(
            new NotFoundException('You have no connected Gmail accounts.'),
          );
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate(
          makeUpdate({
            text: '/disconnect',
            entities: [{ type: 'bot_command', offset: 0, length: 11 }],
          }),
        );

        expect(result).toEqual({ ok: true });
        expect(sendSpy).toHaveBeenCalledWith(
          '98765',
          'You have no connected Gmail accounts.',
        );
      });

      it('confirms revoke success for a single connection with no email arg', async () => {
        const { service, connectionService } = await createService();
        jest.spyOn(connectionService, 'disconnect').mockResolvedValue({
          status: 'disconnected',
          email: 'a@x.com',
          revoked: true,
          activeAfter: null,
        });
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        await service.processUpdate(
          makeUpdate({
            text: '/disconnect',
            entities: [{ type: 'bot_command', offset: 0, length: 11 }],
          }),
        );

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(connectionService.disconnect).toHaveBeenCalledWith(
          '98765',
          undefined,
        );
        expect(sendSpy).toHaveBeenCalledWith(
          '98765',
          expect.stringContaining('Google access has been revoked'),
        );
      });

      it('tells the user to manually clean up when Google revoke fails', async () => {
        const { service, connectionService } = await createService();
        jest.spyOn(connectionService, 'disconnect').mockResolvedValue({
          status: 'disconnected',
          email: 'a@x.com',
          revoked: false,
          activeAfter: null,
        });
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        await service.processUpdate(
          makeUpdate({
            text: '/disconnect',
            entities: [{ type: 'bot_command', offset: 0, length: 11 }],
          }),
        );

        expect(sendSpy).toHaveBeenCalledWith(
          '98765',
          expect.stringContaining('myaccount.google.com/permissions'),
        );
      });

      it('prompts for an email when the account is ambiguous', async () => {
        const { service, connectionService } = await createService();
        jest.spyOn(connectionService, 'disconnect').mockResolvedValue({
          status: 'ambiguous',
          accounts: [
            { email: 'a@x.com', providerAccountId: 'gid-1' },
            { email: 'b@x.com', providerAccountId: 'gid-2' },
          ],
        });
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        await service.processUpdate(
          makeUpdate({
            text: '/disconnect',
            entities: [{ type: 'bot_command', offset: 0, length: 11 }],
          }),
        );

        const message = sendSpy.mock.calls[0][1];
        expect(message).toContain('a@x.com');
        expect(message).toContain('b@x.com');
        expect(message).toContain('/disconnect <email>');
      });

      it('names the newly active account when the active one was removed', async () => {
        const { service, connectionService } = await createService();
        jest.spyOn(connectionService, 'disconnect').mockResolvedValue({
          status: 'disconnected',
          email: 'a@x.com',
          revoked: true,
          activeAfter: {
            status: 'active',
            account: { id: 'c2', email: 'b@x.com', providerAccountId: 'gid-2' },
          },
        });
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        await service.processUpdate(
          makeUpdate({
            text: '/disconnect a@x.com',
            entities: [{ type: 'bot_command', offset: 0, length: 11 }],
          }),
        );

        const message = sendSpy.mock.calls[0][1];
        expect(message).toContain('Disconnected a@x.com');
        expect(message).toContain('Now using b@x.com.');
      });

      it('asks the user to pick when several accounts remain', async () => {
        const { service, connectionService } = await createService();
        jest.spyOn(connectionService, 'disconnect').mockResolvedValue({
          status: 'disconnected',
          email: 'a@x.com',
          revoked: true,
          activeAfter: {
            status: 'ambiguous',
            accounts: [
              { id: 'c2', email: 'b@x.com', providerAccountId: 'gid-2' },
              { id: 'c3', email: 'c@x.com', providerAccountId: 'gid-3' },
            ],
          },
        });
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        await service.processUpdate(
          makeUpdate({
            text: '/disconnect a@x.com',
            entities: [{ type: 'bot_command', offset: 0, length: 11 }],
          }),
        );

        const message = sendSpy.mock.calls[0][1];
        expect(message).toContain('You have 2 accounts left');
        expect(message).toContain('/switch <email>');
      });

      it('passes the email argument through to ConnectionService.disconnect', async () => {
        const { service, connectionService } = await createService();
        jest.spyOn(connectionService, 'disconnect').mockResolvedValue({
          status: 'disconnected',
          email: 'b@x.com',
          revoked: true,
          activeAfter: null,
        });
        jest.spyOn(service, 'sendMessage').mockResolvedValue({ ok: true });

        await service.processUpdate(
          makeUpdate({
            text: '/disconnect b@x.com',
            entities: [{ type: 'bot_command', offset: 0, length: 11 }],
          }),
        );

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(connectionService.disconnect).toHaveBeenCalledWith(
          '98765',
          'b@x.com',
        );
      });

      it('relays the "no match for email" message', async () => {
        const { service, connectionService } = await createService();
        jest
          .spyOn(connectionService, 'disconnect')
          .mockRejectedValue(
            new NotFoundException('No connected account found for nope@x.com.'),
          );
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        await service.processUpdate(
          makeUpdate({
            text: '/disconnect nope@x.com',
            entities: [{ type: 'bot_command', offset: 0, length: 11 }],
          }),
        );

        expect(sendSpy).toHaveBeenCalledWith(
          '98765',
          'No connected account found for nope@x.com.',
        );
      });
    });

    describe('unknown command', () => {
      it('replies with unknown command message', async () => {
        const { service } = await createService();
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate(
          makeUpdate({
            text: '/foo',
            entities: [{ type: 'bot_command', offset: 0, length: 4 }],
          }),
        );

        expect(result).toEqual({ ok: true });
        expect(sendSpy).toHaveBeenCalledWith('98765', 'Unknown command: /foo');
      });
    });

    describe('non-command messages', () => {
      it('ignores messages without text', async () => {
        const { service } = await createService();
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate({
          update_id: 2,
          message: {
            message_id: 101,
            from: { id: 12345, is_bot: false, first_name: 'Test' },
            chat: { id: 98765, type: 'private' },
            date: 1700000001,
          },
        });

        expect(result).toEqual({ ok: true });
        expect(sendSpy).not.toHaveBeenCalled();
      });

      it('ignores text messages that are not commands', async () => {
        const { service } = await createService();
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate(
          makeUpdate({
            text: 'hello there',
            entities: undefined,
          }),
        );

        expect(result).toEqual({ ok: true });
        expect(sendSpy).not.toHaveBeenCalled();
      });

      it('ignores commands sent in a group chat', async () => {
        const { service, connectionService } = await createService();
        const listSpy = jest.spyOn(connectionService, 'listConnections');
        const sendSpy = jest
          .spyOn(service, 'sendMessage')
          .mockResolvedValue({ ok: true });

        const result = await service.processUpdate(
          makeUpdate({
            text: '/connect',
            entities: [{ type: 'bot_command', offset: 0, length: 8 }],
            chat: { id: -100200300, type: 'group' },
          }),
        );

        expect(result).toEqual({ ok: true });
        expect(sendSpy).not.toHaveBeenCalled();
        expect(listSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('/connect user guard', () => {
    it('creates the user when the chat has never run /start', async () => {
      const { service, userService } = await createService();
      jest.spyOn(service, 'sendMessage').mockResolvedValue({ ok: true });
      jest.spyOn(userService, 'findByChatId').mockResolvedValue(null);
      const createSpy = jest
        .spyOn(userService, 'create')
        .mockResolvedValue(mockUserWithRelations);

      await service.processUpdate(
        makeUpdate({
          text: '/connect',
          entities: [{ type: 'bot_command', offset: 0, length: 8 }],
        }),
      );

      expect(createSpy).toHaveBeenCalledWith('98765');
    });

    it('does not recreate an existing user', async () => {
      const { service, userService } = await createService();
      jest.spyOn(service, 'sendMessage').mockResolvedValue({ ok: true });
      jest
        .spyOn(userService, 'findByChatId')
        .mockResolvedValue(mockUserWithRelations);
      const createSpy = jest.spyOn(userService, 'create');

      await service.processUpdate(
        makeUpdate({
          text: '/connect',
          entities: [{ type: 'bot_command', offset: 0, length: 8 }],
        }),
      );

      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('callback_query (confirm / reject)', () => {
    function makeCallbackUpdate(data: string, fromId = 98765) {
      return {
        update_id: 2,
        callback_query: {
          id: 'cbq-1',
          from: { id: fromId },
          message: { chat: { id: 98765, type: 'private' }, message_id: 500 },
          data,
        },
      };
    }

    it('confirms the connection and reports the linked account', async () => {
      const { service, connectionService } = await createService();
      const sendSpy = jest
        .spyOn(service, 'sendMessage')
        .mockResolvedValue({ ok: true });
      const answerSpy = jest
        .spyOn(service, 'answerCallbackQuery')
        .mockResolvedValue();
      jest.spyOn(service, 'editMessageReplyMarkup').mockResolvedValue();
      const confirmSpy = jest
        .spyOn(connectionService, 'confirmConnection')
        .mockResolvedValue({ ok: true, email: 'me@gmail.com' });

      const result = await service.processUpdate(makeCallbackUpdate('c:conn1'));

      expect(result).toEqual({ ok: true });
      expect(confirmSpy).toHaveBeenCalledWith('conn1', '98765');
      expect(sendSpy).toHaveBeenCalledWith(
        '98765',
        expect.stringContaining('me@gmail.com'),
      );
      expect(answerSpy).toHaveBeenCalled();
    });

    it('rejects the connection and confirms revocation to the user', async () => {
      const { service, connectionService } = await createService();
      const sendSpy = jest
        .spyOn(service, 'sendMessage')
        .mockResolvedValue({ ok: true });
      jest.spyOn(service, 'answerCallbackQuery').mockResolvedValue();
      jest.spyOn(service, 'editMessageReplyMarkup').mockResolvedValue();
      const rejectSpy = jest
        .spyOn(connectionService, 'rejectConnection')
        .mockResolvedValue({ ok: true, email: 'me@gmail.com' });

      await service.processUpdate(makeCallbackUpdate('r:conn1'));

      expect(rejectSpy).toHaveBeenCalledWith('conn1', '98765');
      expect(sendSpy).toHaveBeenCalledWith(
        '98765',
        expect.stringContaining('revoked'),
      );
    });

    it('uses the tapping user id, so another user cannot act on the button', async () => {
      const { service, connectionService } = await createService();
      jest.spyOn(service, 'sendMessage').mockResolvedValue({ ok: true });
      jest.spyOn(service, 'answerCallbackQuery').mockResolvedValue();
      const confirmSpy = jest
        .spyOn(connectionService, 'confirmConnection')
        .mockResolvedValue({ ok: false });

      await service.processUpdate(makeCallbackUpdate('c:conn1', 11111));

      expect(confirmSpy).toHaveBeenCalledWith('conn1', '11111');
    });

    it('answers without sending a message when the button is already handled', async () => {
      const { service, connectionService } = await createService();
      const sendSpy = jest
        .spyOn(service, 'sendMessage')
        .mockResolvedValue({ ok: true });
      const answerSpy = jest
        .spyOn(service, 'answerCallbackQuery')
        .mockResolvedValue();
      jest
        .spyOn(connectionService, 'confirmConnection')
        .mockResolvedValue({ ok: false });

      await service.processUpdate(makeCallbackUpdate('c:conn1'));

      expect(sendSpy).not.toHaveBeenCalled();
      expect(answerSpy).toHaveBeenCalledWith(
        'cbq-1',
        expect.stringContaining('Already handled'),
      );
    });

    it('ignores unknown callback data but still answers the query', async () => {
      const { service, connectionService } = await createService();
      const confirmSpy = jest.spyOn(connectionService, 'confirmConnection');
      const rejectSpy = jest.spyOn(connectionService, 'rejectConnection');
      const answerSpy = jest
        .spyOn(service, 'answerCallbackQuery')
        .mockResolvedValue();

      await service.processUpdate(makeCallbackUpdate('garbage'));

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(rejectSpy).not.toHaveBeenCalled();
      expect(answerSpy).toHaveBeenCalled();
    });
  });

  describe('sendConnectionConfirmationPrompt', () => {
    it('sends Confirm/Reject buttons carrying the connection id', async () => {
      const { service } = await createService();
      const sendSpy = jest
        .spyOn(service, 'sendMessage')
        .mockResolvedValue({ ok: true });

      await service.sendConnectionConfirmationPrompt(
        '98765',
        'conn1',
        'me@gmail.com',
      );

      expect(sendSpy).toHaveBeenCalledWith(
        '98765',
        expect.stringContaining('me@gmail.com'),
        {
          replyMarkup: {
            inline_keyboard: [
              [
                { text: 'Confirm', callback_data: 'c:conn1' },
                { text: 'Reject', callback_data: 'r:conn1' },
              ],
            ],
          },
        },
      );
    });

    it('keeps callback_data within Telegram 64-byte limit for a ulid', () => {
      const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      expect(Buffer.byteLength(`c:${ulid}`, 'utf8')).toBeLessThanOrEqual(64);
    });
  });
});
