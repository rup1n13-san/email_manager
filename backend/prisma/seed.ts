import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const user = await prisma.user.upsert({
    where: { telegramChatId: 'test-chat-000000000' },
    update: {},
    create: {
      telegramChatId: 'test-chat-000000000',
    },
  });

  await prisma.emailPreference.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      checkIntervalHours: 4,
      defaultInbox: 'PRIMARY',
      aiEnabled: true,
      aiModel: 'groq',
      notificationStyle: 'detailed',
    },
  });

  console.log(`Seeded user: ${user.id}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
