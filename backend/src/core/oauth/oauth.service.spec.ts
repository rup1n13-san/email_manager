import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionService } from '../connection/connection.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { encodeOAuthState } from '../../common/helpers/oauth-state.js';

const mockGetToken = jest.fn<any>();
const mockSetCredentials = jest.fn<any>();
const mockUserinfoGet = jest.fn<any>();

jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn<any>().mockImplementation(() => ({
        getToken: mockGetToken,
        setCredentials: mockSetCredentials,
      })),
    },
    oauth2: jest.fn<any>().mockReturnValue({
      userinfo: {
        get: mockUserinfoGet,
      },
    }),
  },
}));

type OAuthServiceInstance = {
  handleCallback(code: string, state: string): Promise<void>;
  handleCallbackError(state: string, error: string): Promise<void>;
};

const VALID_KEY =
  '0992b7c6d936d9071b4e285b1794cf935a2b5a5a163c7ef1dc21c31c572960e7';

describe('OAuthService', () => {
  let service: OAuthServiceInstance;

  const mockConnectionService = {
    storeTokens: jest.fn<any>(),
  };
  const mockTelegramService = {
    sendMessage: jest.fn<any>(),
    sendConnectionConfirmationPrompt: jest.fn<any>(),
  };

  // A state as the callback actually receives it: encoded once by us, once by
  // googleapis, then decoded a single layer by Express.
  const stateFor = (chatId: string) =>
    new URL(
      `https://x.test/cb?state=${encodeURIComponent(
        encodeOAuthState(chatId, 'GOOGLE'),
      )}`,
    ).searchParams.get('state')!;

  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';
    process.env.ENCRYPTION_KEY = VALID_KEY;
  });

  afterAll(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.ENCRYPTION_KEY;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConnectionService.storeTokens.mockResolvedValue({ id: 'conn-1' });

    const { OAuthService } = await import('./oauth.service.js');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        { provide: ConnectionService, useValue: mockConnectionService },
        { provide: TelegramService, useValue: mockTelegramService },
      ],
    }).compile();

    service = module.get(OAuthService);
  });

  it('decodes the state and stores tokens against the real chatId', async () => {
    const expiry = Date.now() + 3600_000;
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: 'google-access-token',
        refresh_token: 'google-refresh-token',
        expiry_date: expiry,
      },
    });
    mockUserinfoGet.mockResolvedValue({
      data: { id: 'google-user-1', email: 'test@example.com' },
    });

    await service.handleCallback('valid-code', stateFor('chat-1'));

    expect(mockConnectionService.storeTokens).toHaveBeenCalledWith(
      'chat-1',
      'google-user-1',
      'test@example.com',
      'google-access-token',
      'google-refresh-token',
      expect.any(Date),
    );

    const expiresArg = mockConnectionService.storeTokens.mock
      .calls[0][5] as Date;
    expect(expiresArg.getTime()).toBeCloseTo(expiry, -2);
  });

  it('asks for confirmation instead of announcing a completed connection', async () => {
    mockGetToken.mockResolvedValue({
      tokens: { access_token: 'at', expiry_date: Date.now() + 3600_000 },
    });
    mockUserinfoGet.mockResolvedValue({
      data: { id: 'gid', email: 'test@example.com' },
    });

    await service.handleCallback('valid-code', stateFor('chat-1'));

    expect(
      mockTelegramService.sendConnectionConfirmationPrompt,
    ).toHaveBeenCalledWith('chat-1', 'conn-1', 'test@example.com');
    expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a forged state before contacting Google', async () => {
    await expect(
      service.handleCallback('valid-code', 'forged-state'),
    ).rejects.toThrow('Invalid or expired authorization link');

    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockConnectionService.storeTokens).not.toHaveBeenCalled();
  });

  it('rejects a raw chatId used as state (the pre-fix format)', async () => {
    await expect(
      service.handleCallback('valid-code', 'chat-1'),
    ).rejects.toThrow('Invalid or expired authorization link');
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('rejects an expired state', async () => {
    const realNow = Date.now;
    Date.now = () => realNow() - 11 * 60_000;
    const oldState = stateFor('chat-1');
    Date.now = realNow;

    await expect(
      service.handleCallback('valid-code', oldState),
    ).rejects.toThrow('Invalid or expired authorization link');
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('throws when no access_token in Google response', async () => {
    mockGetToken.mockResolvedValue({ tokens: {} });

    await expect(
      service.handleCallback('bad-code', stateFor('chat-1')),
    ).rejects.toThrow('No access token received');
  });

  it('propagates error when Google returns an error', async () => {
    mockGetToken.mockRejectedValue(
      new Error('invalid_grant: Code was already redeemed.'),
    );

    await expect(
      service.handleCallback('used-code', stateFor('chat-1')),
    ).rejects.toThrow('invalid_grant');
  });

  it('handles missing refresh_token gracefully', async () => {
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: 'access-only',
        expiry_date: Date.now() + 3600_000,
      },
    });
    mockUserinfoGet.mockResolvedValue({
      data: { id: 'google-user-2', email: 'test2@example.com' },
    });

    await service.handleCallback('code-no-refresh', stateFor('chat-2'));

    expect(mockConnectionService.storeTokens).toHaveBeenCalledWith(
      'chat-2',
      'google-user-2',
      'test2@example.com',
      'access-only',
      null,
      expect.any(Date),
    );
  });

  describe('handleCallbackError', () => {
    it('tells the user in Telegram when they cancel consent', async () => {
      await service.handleCallbackError(stateFor('chat-1'), 'access_denied');

      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        'chat-1',
        expect.stringContaining('cancelled'),
      );
      expect(mockConnectionService.storeTokens).not.toHaveBeenCalled();
    });

    it('rejects a forged state on the error path too', async () => {
      await expect(
        service.handleCallbackError('forged', 'access_denied'),
      ).rejects.toThrow('Invalid or expired authorization link');
      expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
    });
  });
});
