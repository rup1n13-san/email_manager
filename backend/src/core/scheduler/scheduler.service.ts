import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class SchedulerService {
  @Cron('0 */4 * * * *')
  handleMonitoring() {
    // TODO: Iterate users, fetch unread, classify, send summary
    console.log('Monitoring cycle tick');
  }
}
