import { randomBytes } from 'node:crypto';
import { EncryptionHelper } from './encryption.js';
import { ConnectionProvider } from '../../generated/prisma/client.js';

// Long enough for a real consent flow (account picker + 2FA), short enough to
// bound replay: the state is forgery-proof via GCM but not single-use.
const STATE_TTL_MS = 10 * 60_000;

export function encodeOAuthState(
  chatId: string,
  provider: ConnectionProvider,
): string {
  const payload = {
    chatId,
    provider,
    nonce: randomBytes(16).toString('base64url'),
    iat: Date.now(),
  };
  return encodeURIComponent(
    new EncryptionHelper().encrypt(JSON.stringify(payload)),
  );
}

export function decodeOAuthState(
  state: string,
  expectedProvider: ConnectionProvider,
): { chatId: string } | null {
  try {
    const payload: unknown = JSON.parse(
      new EncryptionHelper().decrypt(decodeURIComponent(state)),
    );
    if (typeof payload !== 'object' || payload === null) return null;

    const { chatId, provider, iat } = payload as Record<string, unknown>;
    if (typeof chatId !== 'string' || typeof iat !== 'number') return null;
    if (provider !== expectedProvider) return null;
    if (Date.now() - iat > STATE_TTL_MS) return null;

    return { chatId };
  } catch {
    return null;
  }
}
