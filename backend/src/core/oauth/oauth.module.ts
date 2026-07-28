import { Module } from '@nestjs/common';
import { OAuthController } from './oauth.controller.js';
import { OAuthService } from './oauth.service.js';
import { ConnectionModule } from '../connection/connection.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';

@Module({
  imports: [ConnectionModule, TelegramModule],
  controllers: [OAuthController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
