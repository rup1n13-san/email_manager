import { Injectable } from '@nestjs/common';

@Injectable()
export class OAuthService {
  getAuthUrl() {
    // TODO: Generate Google OAuth URL
    return { url: '' };
  }

  handleCallback(_code: string) {
    return { code: _code };
  }
}
