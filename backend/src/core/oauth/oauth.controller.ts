import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { OAuthService } from './oauth.service.js';
import { GoogleCallbackDto } from './dto/google-callback.dto.js';

@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  @Get('google/callback')
  async googleCallback(@Query() dto: GoogleCallbackDto, @Res() res: Response) {
    try {
      await this.oauthService.handleCallback(dto.code, dto.state);
      res.send(successPage());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(400).send(errorPage(message));
    }
  }
}

function successPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><title>Gmail Connected</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 3rem;">
  <h1>Gmail Connected</h1>
  <p>You can close this window and return to Telegram.</p>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><title>Connection Failed</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 3rem;">
  <h1>Connection Failed</h1>
  <p>${escapeHtml(message)}</p>
  <p>Return to Telegram and try /connect again.</p>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
