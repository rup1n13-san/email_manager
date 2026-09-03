import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildGoogleOAuthUrl } from './oauth-url.js';

describe('buildGoogleOAuthUrl', () => {
  const OLD_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const OLD_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const OLD_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI =
      'https://example.com/oauth/google/callback';
  });

  afterAll(() => {
    process.env.GOOGLE_CLIENT_ID = OLD_CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = OLD_CLIENT_SECRET;
    process.env.GOOGLE_REDIRECT_URI = OLD_REDIRECT_URI;
  });

  it('returns a valid Google OAuth URL', () => {
    const url = buildGoogleOAuthUrl('chat123');
    expect(url).toMatch(
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/,
    );
  });

  it('includes state parameter in URL', () => {
    const url = buildGoogleOAuthUrl('chat456');
    const params = new URL(url).searchParams;
    expect(params.get('state')).toBe('chat456');
  });

  it('includes client_id from env', () => {
    const url = buildGoogleOAuthUrl('chat123');
    const params = new URL(url).searchParams;
    expect(params.get('client_id')).toBe(
      'test-client-id.apps.googleusercontent.com',
    );
  });

  it('includes redirect_uri from env', () => {
    const url = buildGoogleOAuthUrl('chat123');
    const params = new URL(url).searchParams;
    expect(params.get('redirect_uri')).toBe(
      'https://example.com/oauth/google/callback',
    );
  });

  it('includes access_type=offline and prompt=consent', () => {
    const url = buildGoogleOAuthUrl('chat123');
    const params = new URL(url).searchParams;
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent');
  });

  it('includes gmail scopes', () => {
    const url = buildGoogleOAuthUrl('chat123');
    const params = new URL(url).searchParams;
    const scope = params.get('scope') ?? '';
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.compose');
  });

  it('includes include_granted_scopes=true', () => {
    const url = buildGoogleOAuthUrl('chat123');
    expect(url).toContain('include_granted_scopes=true');
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
