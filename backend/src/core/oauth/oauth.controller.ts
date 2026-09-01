import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { OAuthService } from './oauth.service.js';
import { GoogleCallbackDto } from './dto/google-callback.dto.js';

@Controller('oauth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(private readonly oauthService: OAuthService) {}

  @Get('google/callback')
  async googleCallback(@Query() dto: GoogleCallbackDto, @Res() res: Response) {
    try {
      if (dto.error) {
        await this.oauthService.handleCallbackError(dto.state, dto.error);
        res.send(cancelledPage());
        return;
      }

      if (!dto.code) {
        res.status(400).send(errorPage());
        return;
      }

      await this.oauthService.handleCallback(dto.code, dto.state);
      res.send(pendingConfirmationPage());
    } catch (error: unknown) {
      // Detail stays server-side: the state is a credential and internal error
      // text should not reach the browser.
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `OAuth callback failed: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      res.status(400).send(errorPage());
    }
  }
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><title>${title}</title></head>
<body style="font-family: sans-serif; text-align: center; padding: 3rem;">
  <h1>${title}</h1>
  ${body}
</body>
</html>`;
}

function pendingConfirmationPage(): string {
  return page(
    'Almost done',
    `<p>Check Telegram and confirm the account to finish connecting.</p>
  <p>You can close this window.</p>`,
  );
}

function cancelledPage(): string {
  return page(
    'Connection Cancelled',
    `<p>No account was linked. Return to Telegram and try /connect again.</p>`,
  );
}

function errorPage(): string {
  return page(
    'Connection Failed',
    `<p>This authorization link is invalid or has expired.</p>
  <p>Return to Telegram and try /connect again.</p>`,
  );
}
