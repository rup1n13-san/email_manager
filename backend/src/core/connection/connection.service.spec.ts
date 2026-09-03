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
  activeConnectionId: null as string | null,
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
      update: jest.fn<any>(),
      updateMany: jest.fn<any>(),
    },
    connection: {
      upsert: jest.fn<any>(),
      update: jest.fn<any>(),
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

  // Shape returned by the activeAccountArgs select — no token columns.
  const first = {
    id: mockConnection.id,
    email: mockConnection.email,
    providerAccountId: mockConnection.providerAccountId,
  };
  const second = {
    id: 'c2',
    email: 'second@x.com',
    providerAccountId: 'gid-2',
  };

  function mockUserWith(
    connections: (typeof first)[],
    activeConnectionId: string | null = null,
  ) {
    prisma.user.findUnique.mockResolvedValue({
      id: mockUser.id,
      activeConnectionId,
      connections,
    });
  }

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

  describe('updateAccessToken', () => {
    it('encrypts the new access token and updates expiresAt', async () => {
      prisma.connection.update.mockResolvedValue(mockConnection);
      const expiresAt = new Date(Date.now() + 3600_000);

      await service.updateAccessToken(
        mockConnection.id,
        'refreshed-access',
        expiresAt,
      );

      expect(prisma.connection.update).toHaveBeenCalledTimes(1);
      const updateCall = prisma.connection.update.mock.calls[0][0] as {
        where: Record<string, unknown>;
        data: { accessToken: string; expiresAt: Date };
      };
      expect(updateCall.where).toEqual({ id: mockConnection.id });
      expect(updateCall.data.accessToken).not.toBe('refreshed-access');
      expect(updateCall.data.accessToken).toMatch(
        /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i,
      );
      expect(updateCall.data.expiresAt).toBe(expiresAt);
    });

    it('treats a P2025 (connection deleted mid-refresh) as an idempotent no-op', async () => {
      prisma.connection.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '7.9.1',
        }),
      );

      await expect(
        service.updateAccessToken(
          mockConnection.id,
          'refreshed-access',
          new Date(),
        ),
      ).resolves.toBeUndefined();
    });

    it('rethrows non-P2025 errors', async () => {
      prisma.connection.update.mockRejectedValue(new Error('db unreachable'));

      await expect(
        service.updateAccessToken(
          mockConnection.id,
          'refreshed-access',
          new Date(),
        ),
      ).rejects.toThrow('db unreachable');
    });
  });

  describe('getActiveTokens', () => {
    it('decrypts the tokens of the resolved active account', async () => {
      mockUserWith([first, second], second.id);
      prisma.connection.findUnique.mockResolvedValue({
        accessToken: encryption.encrypt('decrypted-access'),
        refreshToken: encryption.encrypt('decrypted-refresh'),
        expiresAt: mockConnection.expiresAt,
      });

      const result = await service.getActiveTokens('chat123');

      expect(result).toEqual({
        status: 'active',
        account: second,
        tokens: {
          accessToken: 'decrypted-access',
          refreshToken: 'decrypted-refresh',
          expiresAt: mockConnection.expiresAt,
        },
      });
      expect(prisma.connection.findUnique).toHaveBeenCalledWith({
        where: { id: second.id },
        select: { accessToken: true, refreshToken: true, expiresAt: true },
      });
    });

    it('handles an account that never returned a refresh token', async () => {
      mockUserWith([first], first.id);
      prisma.connection.findUnique.mockResolvedValue({
        accessToken: encryption.encrypt('only-access'),
        refreshToken: null,
        expiresAt: mockConnection.expiresAt,
      });

      const result = await service.getActiveTokens('chat123');

      expect(result).toMatchObject({
        tokens: { accessToken: 'only-access', refreshToken: null },
      });
    });

    it('passes through none when nothing is connected', async () => {
      mockUserWith([]);

      expect(await service.getActiveTokens('chat123')).toEqual({
        status: 'none',
      });
      expect(prisma.connection.findUnique).not.toHaveBeenCalled();
    });

    it('passes through ambiguous instead of picking an inbox', async () => {
      mockUserWith([first, second], null);

      expect(await service.getActiveTokens('chat123')).toEqual({
        status: 'ambiguous',
        accounts: [first, second],
      });
      expect(prisma.connection.findUnique).not.toHaveBeenCalled();
    });

    it('returns none when the account is deleted between resolve and read', async () => {
      mockUserWith([first], first.id);
      prisma.connection.findUnique.mockResolvedValue(null);

      expect(await service.getActiveTokens('chat123')).toEqual({
        status: 'none',
      });
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

  describe('getActive', () => {
    it('filters to confirmed google accounts in the query and selects no tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.getActive('chat123');

      const args = prisma.user.findUnique.mock.calls[0][0] as {
        select: {
          connections: {
            where: Record<string, unknown>;
            select: Record<string, unknown>;
          };
        };
      };
      expect(args.select.connections.where).toEqual({
        provider: 'GOOGLE',
        status: 'CONFIRMED',
      });
      expect(args.select.connections.select).not.toHaveProperty('accessToken');
      expect(args.select.connections.select).not.toHaveProperty('refreshToken');
    });

    it('returns none when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      expect(await service.getActive('unknown')).toEqual({ status: 'none' });
    });

    it('returns none when the user has no confirmed accounts', async () => {
      mockUserWith([]);

      expect(await service.getActive('chat123')).toEqual({ status: 'none' });
    });

    it('returns the only account without writing when the pointer is already correct', async () => {
      mockUserWith([first], first.id);

      expect(await service.getActive('chat123')).toEqual({
        status: 'active',
        account: first,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('adopts the only account and heals a null pointer', async () => {
      mockUserWith([first], null);

      expect(await service.getActive('chat123')).toEqual({
        status: 'active',
        account: first,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { activeConnectionId: first.id },
      });
    });

    it('still returns the account when healing the pointer fails', async () => {
      mockUserWith([first], null);
      prisma.user.update.mockRejectedValue(new Error('row vanished'));

      expect(await service.getActive('chat123')).toEqual({
        status: 'active',
        account: first,
      });
    });

    it('returns the pointed-at account when several are connected', async () => {
      mockUserWith([first, second], second.id);

      expect(await service.getActive('chat123')).toEqual({
        status: 'active',
        account: second,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('is ambiguous when several are connected and no pointer is set', async () => {
      mockUserWith([first, second], null);

      expect(await service.getActive('chat123')).toEqual({
        status: 'ambiguous',
        accounts: [first, second],
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('is ambiguous when the pointer no longer matches a confirmed account', async () => {
      mockUserWith([first, second], 'deleted-or-pending-id');

      expect(await service.getActive('chat123')).toEqual({
        status: 'ambiguous',
        accounts: [first, second],
      });
    });
  });

  describe('setActive', () => {
    it('throws when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.setActive('unknown')).rejects.toThrow(
        'You have no connected Gmail accounts.',
      );
    });

    it('throws when the user has no confirmed accounts', async () => {
      mockUserWith([]);

      await expect(service.setActive('chat123')).rejects.toThrow(
        'You have no connected Gmail accounts.',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('switches to the only account when called bare', async () => {
      mockUserWith([first], null);

      expect(await service.setActive('chat123')).toEqual({
        status: 'switched',
        email: first.email,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { activeConnectionId: first.id },
      });
    });

    it('lists instead of guessing when called bare with several accounts', async () => {
      mockUserWith([first, second], first.id);

      expect(await service.setActive('chat123')).toEqual({
        status: 'ambiguous',
        accounts: [first, second],
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('matches the requested email case-insensitively', async () => {
      mockUserWith([first, second], first.id);

      expect(await service.setActive('chat123', 'SECOND@X.com')).toEqual({
        status: 'switched',
        email: second.email,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { activeConnectionId: second.id },
      });
    });

    it('throws when the email matches no connected account', async () => {
      mockUserWith([first, second], first.id);

      await expect(service.setActive('chat123', 'nope@x.com')).rejects.toThrow(
        'No connected account found for nope@x.com.',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
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
        activeAfter: null,
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
        activeAfter: null,
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
        activeAfter: null,
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
        activeAfter: null,
      });
    });

    it('reports the survivor as newly active when the active account is removed', async () => {
      const conn = encryptedConnection();
      prisma.user.findUnique
        .mockResolvedValueOnce({
          ...mockUser,
          activeConnectionId: conn.id,
          connections: [
            conn,
            { ...encryptedConnection(), id: second.id, email: second.email },
          ],
        })
        // getActive() re-resolves after the delete: one account left.
        .mockResolvedValueOnce({
          id: mockUser.id,
          activeConnectionId: null,
          connections: [second],
        });
      fetchSpy.mockResolvedValue({ ok: true } as Response);

      const result = await service.disconnect('chat123', conn.email);

      expect(result).toEqual({
        status: 'disconnected',
        email: conn.email,
        revoked: true,
        activeAfter: { status: 'active', account: second },
      });
    });

    it('leaves the choice to the user when the active account is removed and several remain', async () => {
      const conn = encryptedConnection();
      const third = {
        id: 'c3',
        email: 'third@x.com',
        providerAccountId: 'gid-3',
      };
      prisma.user.findUnique
        .mockResolvedValueOnce({
          ...mockUser,
          activeConnectionId: conn.id,
          connections: [conn, conn, conn],
        })
        .mockResolvedValueOnce({
          id: mockUser.id,
          activeConnectionId: null,
          connections: [second, third],
        });
      fetchSpy.mockResolvedValue({ ok: true } as Response);

      const result = await service.disconnect('chat123', conn.email);

      expect(result).toEqual({
        status: 'disconnected',
        email: conn.email,
        revoked: true,
        activeAfter: { status: 'ambiguous', accounts: [second, third] },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('does not re-resolve when the removed account was not the active one', async () => {
      const conn = encryptedConnection();
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        activeConnectionId: 'some-other-connection',
        connections: [conn],
      });
      fetchSpy.mockResolvedValue({ ok: true } as Response);

      const result = await service.disconnect('chat123');

      expect(result).toMatchObject({ activeAfter: null });
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
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

    it('activates the account only if the user has none active yet', async () => {
      prisma.connection.findUnique.mockResolvedValue({
        ...mockConnection,
        status: 'PENDING_CONFIRMATION',
        user: { telegramChatId: 'chat123' },
      });
      prisma.connection.updateMany.mockResolvedValue({ count: 1 });

      await service.confirmConnection(mockConnection.id, 'chat123');

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: mockConnection.userId, activeConnectionId: null },
        data: { activeConnectionId: mockConnection.id },
      });
    });

    it('does not touch the active pointer when the confirm was a no-op', async () => {
      prisma.connection.findUnique.mockResolvedValue({
        ...mockConnection,
        status: 'PENDING_CONFIRMATION',
        user: { telegramChatId: 'chat123' },
      });
      prisma.connection.updateMany.mockResolvedValue({ count: 0 });

      await service.confirmConnection(mockConnection.id, 'chat123');

      expect(prisma.user.updateMany).not.toHaveBeenCalled();
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
