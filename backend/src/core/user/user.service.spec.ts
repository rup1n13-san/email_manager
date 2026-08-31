import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const mockUser = {
  id: 'user-1',
  telegramChatId: '12345',
  createdAt: new Date(),
  updatedAt: new Date(),
  preference: null,
  connections: [],
};

const mockPrisma = {
  user: {
    findUnique: jest.fn<any>(),
    create: jest.fn<any>(),
  },
};

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    jest.clearAllMocks();
  });

  describe('findByChatId', () => {
    it('returns a user when found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByChatId('12345');

      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { telegramChatId: '12345' },
        include: { preference: true, connections: true },
      });
    });

    it('returns null when not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findByChatId('unknown');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns a user when found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findById('user-1');

      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        include: { preference: true, connections: true },
      });
    });

    it('returns null when not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('inserts and returns a new user', async () => {
      const newUser = { ...mockUser, telegramChatId: '67890' };
      mockPrisma.user.create.mockResolvedValue(newUser);

      const result = await service.create('67890');

      expect(result).toEqual(newUser);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: { telegramChatId: '67890' },
        include: { preference: true, connections: true },
      });
    });

    it('throws when Prisma fails', async () => {
      mockPrisma.user.create.mockRejectedValue(new Error('DB error'));

      await expect(service.create('12345')).rejects.toThrow('DB error');
    });
  });
});
