import { Module } from '@nestjs/common';
import { ConnectionService } from './connection.service.js';

@Module({
  providers: [ConnectionService],
  exports: [ConnectionService],
})
export class ConnectionModule {}
