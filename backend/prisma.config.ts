import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const rawUrl = process.env.DATABASE_URL ?? '';
const databaseUrl = rawUrl.includes('sslmode') ? rawUrl : `${rawUrl}?sslmode=no-verify`;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'npx tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
