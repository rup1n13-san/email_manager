import { Injectable } from '@nestjs/common';

@Injectable()
export class ConnectionService {
  storeTokens(userId: string, accessToken: string, refreshToken: string) {
    return { userId, accessToken, refreshToken };
  }

  getTokens(userId: string) {
    return { userId };
  }

  deleteTokens(userId: string) {
    return { userId };
  }
}
