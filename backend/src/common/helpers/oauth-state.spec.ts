import { encodeOAuthState, decodeOAuthState } from './oauth-state.js';
import { buildGoogleOAuthUrl } from './oauth-url.js';
import { ConnectionProvider } from '../../generated/prisma/client.js';

const VALID_KEY =
  '0992b7c6d936d9071b4e285b1794cf935a2b5a5a163c7ef1dc21c31c572960e7';

const GOOGLE = ConnectionProvider.GOOGLE;

describe('oauth-state', () => {
  let originalKey: string | undefined;

  beforeAll(() => {
    originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = VALID_KEY;
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = originalKey;
  });

  it('round-trips a chatId through encode and decode', () => {
    const state = encodeOAuthState('chat123', GOOGLE);
    expect(decodeOAuthState(state, GOOGLE)).toEqual({ chatId: 'chat123' });
  });

  it('survives the real auth-URL path (double encoding by googleapis)', () => {
    const OLD_ID = process.env.GOOGLE_CLIENT_ID;
    const OLD_REDIRECT = process.env.GOOGLE_REDIRECT_URI;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_REDIRECT_URI =
      'https://example.com/api/oauth/google/callback';

    const url = buildGoogleOAuthUrl(encodeOAuthState('1960884544', GOOGLE));
    // searchParams.get decodes exactly one layer, same as Express does.
    const asExpressSeesIt = new URL(url).searchParams.get('state')!;

    expect(decodeOAuthState(asExpressSeesIt, GOOGLE)).toEqual({
      chatId: '1960884544',
    });

    process.env.GOOGLE_CLIENT_ID = OLD_ID;
    process.env.GOOGLE_REDIRECT_URI = OLD_REDIRECT;
  });

  it('produces a different state on every call (random nonce)', () => {
    expect(encodeOAuthState('chat123', GOOGLE)).not.toBe(
      encodeOAuthState('chat123', GOOGLE),
    );
  });

  it('returns null for garbage input', () => {
    expect(decodeOAuthState('not-a-valid-state', GOOGLE)).toBeNull();
  });

  it('returns null for a raw chatId (pre-encryption format)', () => {
    expect(decodeOAuthState('1960884544', GOOGLE)).toBeNull();
  });

  it('returns null when the ciphertext is tampered with', () => {
    const parts = decodeURIComponent(encodeOAuthState('chat123', GOOGLE)).split(
      ':',
    );
    const data = Buffer.from(parts[2], 'hex');
    data[0] ^= 0xff;
    const tampered = encodeURIComponent(
      `${parts[0]}:${parts[1]}:${data.toString('hex')}`,
    );
    expect(decodeOAuthState(tampered, GOOGLE)).toBeNull();
  });

  it('returns null when the auth tag is tampered with', () => {
    const parts = decodeURIComponent(encodeOAuthState('chat123', GOOGLE)).split(
      ':',
    );
    const tag = Buffer.from(parts[1], 'hex');
    tag[0] ^= 0xff;
    const tampered = encodeURIComponent(
      `${parts[0]}:${tag.toString('hex')}:${parts[2]}`,
    );
    expect(decodeOAuthState(tampered, GOOGLE)).toBeNull();
  });

  it('returns null for a state older than the TTL', () => {
    const realNow = Date.now;
    Date.now = () => realNow() - 11 * 60_000;
    const state = encodeOAuthState('chat123', GOOGLE);
    Date.now = realNow;

    expect(decodeOAuthState(state, GOOGLE)).toBeNull();
  });

  it('accepts a state just inside the TTL', () => {
    const realNow = Date.now;
    Date.now = () => realNow() - 9 * 60_000;
    const state = encodeOAuthState('chat123', GOOGLE);
    Date.now = realNow;

    expect(decodeOAuthState(state, GOOGLE)).toEqual({ chatId: 'chat123' });
  });

  it('returns null when the provider does not match the callback', () => {
    const state = encodeOAuthState('chat123', GOOGLE);
    expect(
      decodeOAuthState(state, 'MICROSOFT' as ConnectionProvider),
    ).toBeNull();
  });

  it('returns null when decrypted with a different key', () => {
    const state = encodeOAuthState('chat123', GOOGLE);
    process.env.ENCRYPTION_KEY = '1'.repeat(64);
    expect(decodeOAuthState(state, GOOGLE)).toBeNull();
    process.env.ENCRYPTION_KEY = VALID_KEY;
  });
});
