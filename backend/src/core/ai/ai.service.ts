import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  classifyEmail(email: unknown) {
    this.logger.debug('classifyEmail called');
    return { email, category: 'normal' };
  }

  summarizeEmails(emails: unknown[]) {
    this.logger.debug(`summarizeEmails called with ${emails.length} emails`);
    return { emails, summary: '' };
  }
}
