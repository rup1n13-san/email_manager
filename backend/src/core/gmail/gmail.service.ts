import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  listEmails() {
    this.logger.debug('listEmails called');
    return [];
  }

  searchEmails(query: string) {
    this.logger.debug(`searchEmails called with query="${query}"`);
    return { query };
  }

  getEmail(id: string) {
    this.logger.debug(`getEmail called for id=${id}`);
    return { id };
  }

  sendEmail() {
    this.logger.debug('sendEmail called');
    return { sent: true };
  }
}
