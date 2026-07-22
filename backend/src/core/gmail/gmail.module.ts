import { Module } from '@nestjs/common';
import { GmailService } from './gmail.service.js';

@Module({
  providers: [GmailService],
  exports: [GmailService],
})
export class GmailModule {}
