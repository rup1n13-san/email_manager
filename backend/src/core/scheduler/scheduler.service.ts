import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConnectionService } from '../connection/connection.service.js';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly connectionService: ConnectionService) {}

  @Cron('0 */4 * * * *')
  async handleMonitoring() {
    // TODO: Iterate users, fetch unread, classify, send summary
    this.logger.debug('Monitoring cycle tick');

    // Abandoned confirmations are never read again, so they can only be
    // cleaned up on a timer — lazy expiry would leave live Google grants.
    await this.connectionService.sweepStalePending();
  }
}
