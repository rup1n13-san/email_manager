import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { buildConnectionString } from './connection-string.js';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    const connectionString = buildConnectionString(
      process.env.DATABASE_URL as string,
      process.env.DB_SSLMODE,
    );
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }
}
