import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionService } from '../connection/connection.service.js';

const mockSetCredentials = jest.fn<any>();
const mockOn = jest.fn<any>();
const mockGmailFactory = jest.fn<any>();

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

type GmailServiceInstance = {
  getClient(
    chatId: string,
  ): Promise<
    | { status: 'active'; gmail: unknown; account: { id: string } }
    | { status: 'none' }
    | { status: 'ambiguous'; accounts: unknown[] }
    | { status: 'needs_reconnect' }
  >;
};

describe('GmailService', () => {
  let service: GmailServiceInstance;

  const mockConnectionService = {
    getActiveTokens: jest.fn<any>(),
    updateAccessToken: jest.fn<any>(),
  };

  const account = { id: 'conn-1', email: 'user@example.com' };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGmailFactory.mockReturnValue({ users: {} });

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
});
