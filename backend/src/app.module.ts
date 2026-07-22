import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TelegramModule } from './core/telegram/telegram.module.js';
import { OAuthModule } from './core/oauth/oauth.module.js';
import { GmailModule } from './core/gmail/gmail.module.js';
import { AiModule } from './core/ai/ai.module.js';
import { UserModule } from './core/user/user.module.js';
import { ConnectionModule } from './core/connection/connection.module.js';
import { SchedulerModule } from './core/scheduler/scheduler.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    PrismaModule,
    TelegramModule,
    OAuthModule,
    GmailModule,
    AiModule,
    UserModule,
    ConnectionModule,
    SchedulerModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
