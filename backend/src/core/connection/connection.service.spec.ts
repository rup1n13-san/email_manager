import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionService } from './connection.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EncryptionHelper } from '../../common/helpers/encryption.js';

const VALID_KEY =
  '0992b7c6d936d9071b4e285b1794cf935a2b5a5a163c7ef1dc21c31c572960e7';

const mockUser = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  telegramChatId: 'chat123',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockConnection = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  userId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  provider: 'google',
  providerUserId: 'google-user-123',
  accessToken: '',
  refreshToken: '',
  expiresAt: new Date(Date.now() + 3600_000),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function mockPrisma() {
  return {
    user: {
      findUnique: jest.fn<any>(),
    },
    connection: {
      upsert: jest.fn<any>(),
      deleteMany: jest.fn<any>(),
    },
  };
}

describe('ConnectionService', () => {
  let service: ConnectionService;
  let prisma: ReturnType<typeof mockPrisma>;
  let encryption: EncryptionHelper;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
  });

  afterAll(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  beforeEach(async () => {
    prisma = mockPrisma();
    encryption = new EncryptionHelper();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionHelper, useValue: encryption },
      ],
    }).compile();

    service = module.get<ConnectionService>(ConnectionService);
    jest.clearAllMocks();
  });

  describe('storeTokens', () => {
    it('encrypts tokens and upserts connection', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.connection.upsert.mockResolvedValue(mockConnection);

      const expiresAt = new Date(Date.now() + 3600_000);
      await service.storeTokens(
        'chat123',
        'google-user-123',
        'raw-access',
        'raw-refresh',
        expiresAt,
      );

      const upsertCall = prisma.connection.upsert.mock.calls[0][0] as {
        create: { accessToken: string; refreshToken: string };
        where: Record<string, unknown>;
      };
      expect(upsertCall.create.accessToken).not.toBe('raw-access');
      expect(upsertCall.create.refreshToken).not.toBe('raw-refresh');
      expect(upsertCall.create.accessToken).toMatch(
        /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i,
      );
      expect(upsertCall.create.refreshToken).toMatch(
        /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i,
      );
      expect(upsertCall.where).toEqual({
        userId_provider: { userId: mockUser.id, provider: 'google' },
      });
    });

    it('uses upsert so reconnecting updates existing record', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await service.storeTokens(
        'chat123',
        'google-user-123',
        'access',
        'refresh',
        new Date(),
      );

      expect(prisma.connection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            providerUserId: 'google-user-123',
          }),
        }),
      );
    });

    it('throws when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.storeTokens('unknown', 'gid', 'at', 'rt', new Date()),
      ).rejects.toThrow('User not found');
    });
  });

  describe('getTokens', () => {
    it('returns decrypted tokens when connection exists', async () => {
      const encryptedAccess = encryption.encrypt('decrypted-access');
      const encryptedRefresh = encryption.encrypt('decrypted-refresh');

      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [
          {
            ...mockConnection,
            accessToken: encryptedAccess,
            refreshToken: encryptedRefresh,
          },
        ],
      });

      const result = await service.getTokens('chat123');

      expect(result).toEqual({
        accessToken: 'decrypted-access',
        refreshToken: 'decrypted-refresh',
        expiresAt: expect.any(Date),
      });
    });

    it('returns null when no connection exists', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [],
      });

      const result = await service.getTokens('chat123');
      expect(result).toBeNull();
    });

    it('throws when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getTokens('unknown')).rejects.toThrow(
        'User not found',
      );
    });
  });

  describe('deleteTokens', () => {
    it('deletes the google connection for the user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.connection.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteTokens('chat123');

      expect(prisma.connection.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id, provider: 'google' },
      });
    });

    it('throws when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteTokens('unknown')).rejects.toThrow(
        'User not found',
      );
    });
  });
});
