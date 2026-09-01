import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service.js';
import { ConnectionModule } from '../connection/connection.module.js';

@Module({
  imports: [ConnectionModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
