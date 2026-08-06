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
};

describe('OAuthService', () => {
  let service: OAuthServiceInstance;

  const mockConnectionService = {
    storeTokens: jest.fn<any>(),
  };
  const mockTelegramService = {
    sendMessage: jest.fn<any>(),
  };

  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';
  });

  afterAll(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
  });

  beforeEach(async () => {
    jest.clearAllMocks();

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

  it('exchanges code for tokens, stores them, and sends confirmation', async () => {
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

    await service.handleCallback('valid-code', 'chat-1');

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

    expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.stringContaining('test@example.com'),
    );
  });

  it('throws when no access_token in Google response', async () => {
    mockGetToken.mockResolvedValue({ tokens: {} });

    await expect(service.handleCallback('bad-code', 'chat-1')).rejects.toThrow(
      'No access token received',
    );
  });

  it('propagates error when Google returns an error', async () => {
    mockGetToken.mockRejectedValue(
      new Error('invalid_grant: Code was already redeemed.'),
    );

    await expect(service.handleCallback('used-code', 'chat-1')).rejects.toThrow(
      'invalid_grant',
    );
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

    await service.handleCallback('code-no-refresh', 'chat-2');

    expect(mockConnectionService.storeTokens).toHaveBeenCalledWith(
      'chat-2',
      'google-user-2',
      'test2@example.com',
      'access-only',
      '',
      expect.any(Date),
    );
  });
});
