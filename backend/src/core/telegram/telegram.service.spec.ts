import { jest } from '@jest/globals';
import { TelegramService } from './telegram.service.js';

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

describe('TelegramService', () => {
  let service: TelegramService;
  let originalToken: string | undefined;

  beforeAll(() => {
    originalToken = process.env.TELEGRAM_BOT_TOKEN;
  });

  beforeEach(() => {
    service = new TelegramService();
    jest.restoreAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  });

  afterAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
  });

  describe('sendMessage', () => {
    it('sends a message and returns ok=true on success', async () => {
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

      await expect(service.sendMessage(CHAT_ID, 'test')).rejects.toThrow(
        'TELEGRAM_BOT_TOKEN is not set',
      );
    });

    it('throws on API error without parseMode', async () => {
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
          body: JSON.stringify({
            chat_id: CHAT_ID,
            action: 'typing',
          }),
        },
      );
    });

    it('throws when TELEGRAM_BOT_TOKEN is missing', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;

      await expect(service.sendTyping(CHAT_ID)).rejects.toThrow(
        'TELEGRAM_BOT_TOKEN is not set',
      );
    });

    it('throws on API error', async () => {
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
});
