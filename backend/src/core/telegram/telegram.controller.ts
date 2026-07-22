import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { TelegramWebhookGuard } from '../../common/guards/telegram/telegram.guard.js';
import { TelegramService } from './telegram.service.js';

@Controller('webhook')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Post()
  @UseGuards(TelegramWebhookGuard)
  handleUpdate(@Body() update: unknown) {
    return this.telegramService.processUpdate(update);
  }
}
