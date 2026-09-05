// Manual one-off test against a real connected Gmail account.
// Not part of the build or test suite.
//
// Must run via ts-node, not tsx: NestJS dependency injection needs
// emitDecoratorMetadata, which tsx's esbuild-based transform does not
// implement — constructor-injected services end up undefined at runtime.
//
// Usage (from backend/):
//   npm run gmail:manual-test -- <chatId> <yourOwnEmail>
//
// <chatId>      the Telegram chatId of an account that has already run
//               /connect and confirmed it (status CONFIRMED in the DB)
// <yourOwnEmail> where the test draft gets sent — use your own address so
//               step 9 (sendDraft) doesn't email anyone else

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { GmailService } from '../src/core/gmail/gmail.service.js';

function show(label: string, result: unknown) {
  console.log(`\n--- ${label} ---`);
  console.dir(result, { depth: null });
}

async function main() {
  const [, , chatId, toEmail] = process.argv;
  if (!chatId || !toEmail) {
    console.error(
      'Usage: npm run gmail:manual-test -- <chatId> <yourOwnEmail>',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const gmail = app.get(GmailService);

    const list = await gmail.listEmails(chatId, 5);
    show('1. listEmails', list);

    if (list.status === 'ok' && list.data[0]) {
      const one = await gmail.getEmail(chatId, list.data[0].id);
      show('2. getEmail', one);
    } else {
      console.log('\n(2. getEmail skipped — no message id from listEmails)');
    }

    const search = await gmail.searchEmails(chatId, 'is:unread', 5);
    show('3. searchEmails', search);

    const draftA = await gmail.createDraft(
      chatId,
      toEmail,
      'Test draft A',
      'To be sent',
    );
    show('4. createDraft (A - will be sent)', draftA);

    const draftB = await gmail.createDraft(
      chatId,
      toEmail,
      'Test draft B',
      'To be deleted',
    );
    show('5. createDraft (B - will be deleted)', draftB);

    if (draftA.status === 'ok') {
      const got = await gmail.getDraft(chatId, draftA.data.id);
      show('6. getDraft (A)', got);
    } else {
      console.log('\n(6. getDraft skipped — createDraft A did not succeed)');
    }

    const drafts = await gmail.listDrafts(chatId, 5);
    show('7. listDrafts', drafts);

    if (draftA.status === 'ok') {
      const updated = await gmail.updateDraft(
        chatId,
        draftA.data.id,
        toEmail,
        'Test draft A (updated)',
        'Updated body',
      );
      show('8. updateDraft (A)', updated);

      const sent = await gmail.sendDraft(chatId, draftA.data.id);
      show(`9. sendDraft (A) — real email just sent to ${toEmail}`, sent);
    } else {
      console.log(
        '\n(8-9. updateDraft/sendDraft skipped — createDraft A did not succeed)',
      );
    }

    if (draftB.status === 'ok') {
      const deleted = await gmail.deleteDraft(chatId, draftB.data.id);
      show('10. deleteDraft (B)', deleted);
    } else {
      console.log(
        '\n(10. deleteDraft skipped — createDraft B did not succeed)',
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exitCode = 1;
});
