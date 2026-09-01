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
  provider: 'GOOGLE',
  providerAccountId: 'google-user-123',
  email: 'test@example.com',
  accessToken: '',
  refreshToken: '',
  expiresAt: new Date(Date.now() + 3600_000),
  status: 'CONFIRMED',
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
      findUnique: jest.fn<any>(),
      findMany: jest.fn<any>(),
      updateMany: jest.fn<any>(),
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
        'test@example.com',
        'raw-access',
        'raw-refresh',
        expiresAt,
      );

      const upsertCall = prisma.connection.upsert.mock.calls[0][0] as {
        create: { accessToken: string; refreshToken: string; status: string };
        where: Record<string, unknown>;
      };
      expect(upsertCall.create.status).toBe('PENDING_CONFIRMATION');
      expect(upsertCall.create.accessToken).not.toBe('raw-access');
      expect(upsertCall.create.refreshToken).not.toBe('raw-refresh');
      expect(upsertCall.create.accessToken).toMatch(
        /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i,
      );
      expect(upsertCall.create.refreshToken).toMatch(
        /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i,
      );
      expect(upsertCall.where).toEqual({
        userId_provider_providerAccountId: {
          userId: mockUser.id,
          provider: 'GOOGLE',
          providerAccountId: 'google-user-123',
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

    it('does not touch status on update, so an already-confirmed account stays confirmed on refresh', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await service.storeTokens(
        'chat123',
        'google-user-123',
        'test@example.com',
        'access',
        'refresh',
        new Date(),
      );

      const upsertCall = prisma.connection.upsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      expect(upsertCall.update).not.toHaveProperty('status');
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

    it('ignores a connection still pending confirmation', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [{ ...mockConnection, status: 'PENDING_CONFIRMATION' }],
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
    it('returns google connections mapped to email/providerAccountId', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [
          mockConnection,
          {
            ...mockConnection,
            id: 'c2',
            email: 'second@x.com',
            providerAccountId: 'gid-2',
          },
        ],
      });

      const result = await service.listConnections('chat123');

      expect(result).toEqual([
        { email: 'test@example.com', providerAccountId: 'google-user-123' },
        { email: 'second@x.com', providerAccountId: 'gid-2' },
      ]);
    });

    it('returns an empty array when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.listConnections('unknown');
      expect(result).toEqual([]);
    });

    it('excludes connections still pending confirmation', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [
          mockConnection,
          { ...mockConnection, id: 'c2', status: 'PENDING_CONFIRMATION' },
        ],
      });

      const result = await service.listConnections('chat123');

      expect(result).toEqual([
        { email: 'test@example.com', providerAccountId: 'google-user-123' },
      ]);
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

    it('treats a pending-confirmation connection as not connected', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [
          { ...encryptedConnection(), status: 'PENDING_CONFIRMATION' },
        ],
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
        providerAccountId: 'gid-2',
      };
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        connections: [connA, connB],
      });

      const result = await service.disconnect('chat123');

      expect(result).toEqual({
        status: 'ambiguous',
        accounts: [
          { email: connA.email, providerAccountId: connA.providerAccountId },
          { email: connB.email, providerAccountId: connB.providerAccountId },
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
        providerAccountId: 'gid-2',
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

  describe('confirmConnection', () => {
    it('confirms a pending connection owned by the requesting chat', async () => {
      prisma.connection.findUnique.mockResolvedValue({
        ...mockConnection,
        status: 'PENDING_CONFIRMATION',
        user: { telegramChatId: 'chat123' },
      });
      prisma.connection.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.confirmConnection(
        mockConnection.id,
        'chat123',
      );

      expect(result).toEqual({ ok: true, email: mockConnection.email });
      expect(prisma.connection.updateMany).toHaveBeenCalledWith({
        where: { id: mockConnection.id, status: 'PENDING_CONFIRMATION' },
        data: { status: 'CONFIRMED' },
      });
    });

    it('refuses when the requesting chat does not own the connection', async () => {
      prisma.connection.findUnique.mockResolvedValue({
        ...mockConnection,
        status: 'PENDING_CONFIRMATION',
        user: { telegramChatId: 'someone-else' },
      });

      const result = await service.confirmConnection(
        mockConnection.id,
        'chat123',
      );

      expect(result).toEqual({ ok: false });
      expect(prisma.connection.updateMany).not.toHaveBeenCalled();
    });

    it('returns ok=false when the connection no longer exists', async () => {
      prisma.connection.findUnique.mockResolvedValue(null);

      const result = await service.confirmConnection('missing', 'chat123');

      expect(result).toEqual({ ok: false });
      expect(prisma.connection.updateMany).not.toHaveBeenCalled();
    });

    it('returns ok=false when already decided (double-tap, count=0)', async () => {
      prisma.connection.findUnique.mockResolvedValue({
        ...mockConnection,
        status: 'PENDING_CONFIRMATION',
        user: { telegramChatId: 'chat123' },
      });
      prisma.connection.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.confirmConnection(
        mockConnection.id,
        'chat123',
      );

      expect(result).toEqual({ ok: false });
    });
  });

  describe('rejectConnection', () => {
    let fetchSpy: jest.SpiedFunction<typeof fetch>;

    beforeEach(() => {
      fetchSpy = jest.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('revokes the held token and deletes a pending connection owned by the requesting chat', async () => {
      prisma.connection.findUnique.mockResolvedValue({
        ...mockConnection,
        accessToken: encryption.encrypt('access-plain'),
        refreshToken: encryption.encrypt('refresh-plain'),
        status: 'PENDING_CONFIRMATION',
        user: { telegramChatId: 'chat123' },
      });
      prisma.connection.deleteMany.mockResolvedValue({ count: 1 });
      fetchSpy.mockResolvedValue({ ok: true } as Response);

      const result = await service.rejectConnection(
        mockConnection.id,
        'chat123',
      );

      expect(result).toEqual({ ok: true, email: mockConnection.email });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/revoke',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(prisma.connection.deleteMany).toHaveBeenCalledWith({
        where: { id: mockConnection.id, status: 'PENDING_CONFIRMATION' },
      });
    });

    it('does NOT revoke when a concurrent confirm already claimed the row', async () => {
      prisma.connection.findUnique.mockResolvedValue({
        ...mockConnection,
        accessToken: encryption.encrypt('access-plain'),
        refreshToken: encryption.encrypt('refresh-plain'),
        status: 'PENDING_CONFIRMATION',
        user: { telegramChatId: 'chat123' },
      });
      // The row flipped to CONFIRMED between our read and our delete.
      prisma.connection.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.rejectConnection(
        mockConnection.id,
        'chat123',
      );

      expect(result).toEqual({ ok: false });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refuses when the requesting chat does not own the connection', async () => {
      prisma.connection.findUnique.mockResolvedValue({
        ...mockConnection,
        status: 'PENDING_CONFIRMATION',
        user: { telegramChatId: 'someone-else' },
      });

      const result = await service.rejectConnection(
        mockConnection.id,
        'chat123',
      );

      expect(result).toEqual({ ok: false });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(prisma.connection.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses when the connection is already confirmed', async () => {
      prisma.connection.findUnique.mockResolvedValue({
        ...mockConnection,
        status: 'CONFIRMED',
        user: { telegramChatId: 'chat123' },
      });

      const result = await service.rejectConnection(
        mockConnection.id,
        'chat123',
      );

      expect(result).toEqual({ ok: false });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('sweepStalePending', () => {
    let fetchSpy: jest.SpiedFunction<typeof fetch>;

    beforeEach(() => {
      fetchSpy = jest.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('revokes and deletes stale pending connections', async () => {
      const stale = {
        ...mockConnection,
        accessToken: encryption.encrypt('access-plain'),
        refreshToken: encryption.encrypt('refresh-plain'),
        status: 'PENDING_CONFIRMATION',
      };
      prisma.connection.findMany.mockResolvedValue([stale]);
      prisma.connection.deleteMany.mockResolvedValue({ count: 1 });
      fetchSpy.mockResolvedValue({ ok: true } as Response);

      await service.sweepStalePending();

      expect(prisma.connection.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING_CONFIRMATION',
          updatedAt: { lt: expect.any(Date) },
        },
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/revoke',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(prisma.connection.deleteMany).toHaveBeenCalledWith({
        where: { id: stale.id, status: 'PENDING_CONFIRMATION' },
      });
    });

    it('does NOT revoke a row a concurrent confirm claimed mid-sweep', async () => {
      prisma.connection.findMany.mockResolvedValue([
        {
          ...mockConnection,
          accessToken: encryption.encrypt('access-plain'),
          refreshToken: encryption.encrypt('refresh-plain'),
          status: 'PENDING_CONFIRMATION',
        },
      ]);
      prisma.connection.deleteMany.mockResolvedValue({ count: 0 });

      await service.sweepStalePending();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does nothing when there are no stale pending connections', async () => {
      prisma.connection.findMany.mockResolvedValue([]);

      await service.sweepStalePending();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(prisma.connection.deleteMany).not.toHaveBeenCalled();
    });
  });
});
