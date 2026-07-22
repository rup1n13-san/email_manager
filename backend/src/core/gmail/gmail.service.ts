import { Injectable } from '@nestjs/common';

@Injectable()
export class GmailService {
  listEmails() {
    return [];
  }

  searchEmails(query: string) {
    return { query };
  }

  getEmail(id: string) {
    return { id };
  }

  sendEmail() {
    return { sent: true };
  }
}
