import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { TelegramService } from './telegram.service.js';
import { UserService } from '../user/user.service.js';

const BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
const CHAT_ID = '98765';

function mockFetch(response: Partial<Response>) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(response as Response);
}

interface FetchCallArgs {
  body: string;
}

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
    ],
  }).compile();

  return {
    service: module.get<TelegramService>(TelegramService),
    userService: module.get<UserService>(UserService),
  };
}

describe('TelegramService', () => {
  let originalToken: string | undefined;

  beforeAll(() => {
    originalToken = process.env.TELEGRAM_BOT_TOKEN;
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  });

  afterAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
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
    });
  });
});
