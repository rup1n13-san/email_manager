import { Controller, Get, Query } from '@nestjs/common';
import { OAuthService } from './oauth.service.js';

@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  @Get('google')
  googleAuth() {
    return this.oauthService.getAuthUrl();
  }

  @Get('google/callback')
  googleCallback(@Query('code') code: string) {
    return this.oauthService.handleCallback(code);
  }
}
