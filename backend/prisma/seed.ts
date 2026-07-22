import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL as string,
});
const prisma = new PrismaClient({ adapter });

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
