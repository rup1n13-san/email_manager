import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  @Cron('0 */4 * * * *')
  handleMonitoring() {
    // TODO: Iterate users, fetch unread, classify, send summary
    this.logger.debug('Monitoring cycle tick');
  }
}
