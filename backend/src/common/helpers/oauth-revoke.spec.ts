import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { revokeGoogleToken } from './oauth-revoke.js';

describe('revokeGoogleToken', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('returns true and posts the token to the revoke endpoint on success', async () => {
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true } as Response);

    const result = await revokeGoogleToken('a-refresh-token');

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'token=a-refresh-token',
      },
    );
  });

  it('returns false when the endpoint responds not-ok', async () => {
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false } as Response);

    const result = await revokeGoogleToken('a-refresh-token');
    expect(result).toBe(false);
  });

  it('returns false when fetch throws', async () => {
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network down'));

    const result = await revokeGoogleToken('a-refresh-token');
    expect(result).toBe(false);
  });

  it('returns false and does not call fetch for an empty token', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');

    const result = await revokeGoogleToken('');

    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
