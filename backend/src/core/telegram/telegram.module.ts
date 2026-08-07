import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller.js';
import { TelegramService } from './telegram.service.js';
import { UserModule } from '../user/user.module.js';
import { ConnectionModule } from '../connection/connection.module.js';

@Module({
  imports: [UserModule, ConnectionModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
