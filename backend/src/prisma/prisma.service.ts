import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    let connectionString = process.env.DATABASE_URL as string;
    if (connectionString && !connectionString.includes('sslmode')) {
      connectionString += '?sslmode=require';
    }
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }
}
