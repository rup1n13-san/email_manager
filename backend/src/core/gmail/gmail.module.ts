import { Module } from '@nestjs/common';
import { GmailService } from './gmail.service.js';
import { ConnectionModule } from '../connection/connection.module.js';

@Module({
  imports: [ConnectionModule],
  providers: [GmailService],
  exports: [GmailService],
})
export class GmailModule {}
