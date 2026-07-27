import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildGoogleOAuthUrl } from './oauth-url.js';

describe('buildGoogleOAuthUrl', () => {
  const OLD_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const OLD_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_REDIRECT_URI =
      'https://example.com/oauth/google/callback';
  });

  afterAll(() => {
    process.env.GOOGLE_CLIENT_ID = OLD_CLIENT_ID;
    process.env.GOOGLE_REDIRECT_URI = OLD_REDIRECT_URI;
  });

  it('returns a URL containing the Google OAuth endpoint', () => {
    const url = buildGoogleOAuthUrl('chat123');
    expect(url).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/,
    );
  });

  it('includes client_id from env', () => {
    const url = buildGoogleOAuthUrl('chat123');
    expect(url).toContain(
      'client_id=test-client-id.apps.googleusercontent.com',
    );
  });

  it('includes redirect_uri from env', () => {
    const url = buildGoogleOAuthUrl('chat123');
    expect(url).toContain(
      'redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fgoogle%2Fcallback',
    );
  });

  it('includes the state parameter', () => {
    const url = buildGoogleOAuthUrl('chat456');
    expect(url).toContain('state=chat456');
  });

  it('includes access_type=offline and prompt=consent', () => {
    const url = buildGoogleOAuthUrl('chat123');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
  });

  it('includes gmail scopes', () => {
    const url = buildGoogleOAuthUrl('chat123');
    expect(url).toContain(
      'https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly',
    );
    expect(url).toContain(
      'https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.send',
    );
  });

  it('throws when GOOGLE_CLIENT_ID is missing', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(() => buildGoogleOAuthUrl('chat123')).toThrow(
      'Google OAuth is not configured',
    );
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  });

  it('throws when GOOGLE_REDIRECT_URI is missing', () => {
    delete process.env.GOOGLE_REDIRECT_URI;
    expect(() => buildGoogleOAuthUrl('chat123')).toThrow(
      'Google OAuth is not configured',
    );
    process.env.GOOGLE_REDIRECT_URI =
      'https://example.com/oauth/google/callback';
  });
});
