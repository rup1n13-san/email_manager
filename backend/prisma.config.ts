import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const rawUrl = process.env.DATABASE_URL ?? '';
const sslMode = process.env.DB_SSLMODE;
const databaseUrl = sslMode && !rawUrl.includes('sslmode')
  ? `${rawUrl}?sslmode=${sslMode}`
  : rawUrl;

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
