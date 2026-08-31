import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionService } from './connection.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EncryptionHelper } from '../../common/helpers/encryption.js';
import { Prisma } from '../../generated/prisma/client.js';

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
  email: 'test@example.com',
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
      delete: jest.fn<any>(),
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
        'test@example.com',
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
        userId_provider_providerUserId: {
          userId: mockUser.id,
          provider: 'google',
          providerUserId: 'google-user-123',
        },
      });
    });

    it('uses upsert so reconnecting the same account updates the existing record', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await service.storeTokens(
        'chat123',
        'google-user-123',
        'test@example.com',
        'access',
        'refresh',
        new Date(),
      );

      expect(prisma.connection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            email: 'test@example.com',
          }),
        }),
      );
    });

    it('throws when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.storeTokens(
          'unknown',
          'gid',
          'e@x.com',
          'at',
          'rt',
          new Date(),
        ),
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

  describe('listConnections', () => {
    it('returns google connections mapped to email/providerUserId', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [
          mockConnection,
          {
            ...mockConnection,
            id: 'c2',
            email: 'second@x.com',
            providerUserId: 'gid-2',
          },
        ],
      });

      const result = await service.listConnections('chat123');

      expect(result).toEqual([
        { email: 'test@example.com', providerUserId: 'google-user-123' },
        { email: 'second@x.com', providerUserId: 'gid-2' },
      ]);
    });

    it('returns an empty array when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.listConnections('unknown');
      expect(result).toEqual([]);
    });
  });

  describe('disconnect', () => {
    const encryptedConnection = () => ({
      ...mockConnection,
      accessToken: encryption.encrypt('access-plain'),
      refreshToken: encryption.encrypt('refresh-plain'),
    });

    let fetchSpy: jest.SpiedFunction<typeof fetch>;

    beforeEach(() => {
      fetchSpy = jest.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('throws when there are no connections', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [],
      });

      await expect(service.disconnect('chat123')).rejects.toThrow(
        'You have no connected Gmail accounts.',
      );
    });

    it('revokes with Google and deletes the single connection when no email arg is given', async () => {
      const conn = encryptedConnection();
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [conn],
      });
      fetchSpy.mockResolvedValue({ ok: true } as Response);

      const result = await service.disconnect('chat123');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/revoke',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(prisma.connection.delete).toHaveBeenCalledWith({
        where: { id: conn.id },
      });
      expect(result).toEqual({
        status: 'disconnected',
        email: conn.email,
        revoked: true,
      });
    });

    it('still deletes locally when the Google revoke call fails', async () => {
      const conn = encryptedConnection();
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [conn],
      });
      fetchSpy.mockResolvedValue({ ok: false } as Response);

      const result = await service.disconnect('chat123');

      expect(prisma.connection.delete).toHaveBeenCalledWith({
        where: { id: conn.id },
      });
      expect(result).toEqual({
        status: 'disconnected',
        email: conn.email,
        revoked: false,
      });
    });

    it('returns ambiguous status with no deletion when multiple connections exist and no email given', async () => {
      const connA = encryptedConnection();
      const connB = {
        ...encryptedConnection(),
        id: 'c2',
        email: 'second@x.com',
        providerUserId: 'gid-2',
      };
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [connA, connB],
      });

      const result = await service.disconnect('chat123');

      expect(result).toEqual({
        status: 'ambiguous',
        accounts: [
          { email: connA.email, providerUserId: connA.providerUserId },
          { email: connB.email, providerUserId: connB.providerUserId },
        ],
      });
      expect(prisma.connection.delete).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('disconnects the matching connection by email (case-insensitive) when multiple exist', async () => {
      const connA = encryptedConnection();
      const connB = {
        ...encryptedConnection(),
        id: 'c2',
        email: 'second@x.com',
        providerUserId: 'gid-2',
      };
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [connA, connB],
      });
      fetchSpy.mockResolvedValue({ ok: true } as Response);

      const result = await service.disconnect('chat123', 'SECOND@x.com');

      expect(prisma.connection.delete).toHaveBeenCalledWith({
        where: { id: connB.id },
      });
      expect(result).toEqual({
        status: 'disconnected',
        email: connB.email,
        revoked: true,
      });
    });

    it('throws when the given email does not match any connection', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [encryptedConnection()],
      });

      await expect(service.disconnect('chat123', 'nope@x.com')).rejects.toThrow(
        'No connected account found for nope@x.com.',
      );
    });

    it('treats a P2025 (already deleted) error as an idempotent success', async () => {
      const conn = encryptedConnection();
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [conn],
      });
      fetchSpy.mockResolvedValue({ ok: true } as Response);
      prisma.connection.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '7.9.1',
        }),
      );

      const result = await service.disconnect('chat123');

      expect(result).toEqual({
        status: 'disconnected',
        email: conn.email,
        revoked: true,
      });
    });
  });
});
