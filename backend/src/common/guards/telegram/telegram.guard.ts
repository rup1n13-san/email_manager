import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class TelegramWebhookGuard implements CanActivate {
  private readonly logger = new Logger(TelegramWebhookGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const secret = request.headers['x-telegram-bot-api-secret-token'];

    if (!secret || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      this.logger.warn('Rejected webhook request: invalid secret');
      throw new UnauthorizedException('Invalid Telegram webhook secret');
    }

    return true;
  }
}
