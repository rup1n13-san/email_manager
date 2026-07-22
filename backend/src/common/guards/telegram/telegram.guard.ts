import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class TelegramWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const secret = request.headers['x-telegram-bot-api-secret-token'];

    if (!secret || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      throw new UnauthorizedException('Invalid Telegram webhook secret');
    }

    return true;
  }
}
