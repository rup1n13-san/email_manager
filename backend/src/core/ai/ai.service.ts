import { Injectable } from '@nestjs/common';

@Injectable()
export class AiService {
  classifyEmail(email: unknown) {
    return { email, category: 'normal' };
  }

  summarizeEmails(emails: unknown[]) {
    return { emails, summary: '' };
  }
}
