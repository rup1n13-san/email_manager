import { describe, it, expect } from '@jest/globals';
import { classifyGmailError } from './gmail-error.js';

function makeError(status: number, data?: unknown) {
  return Object.assign(new Error('gaxios-like'), {
    status,
    response: { data },
  });
}

describe('classifyGmailError', () => {
  it('classifies 401 as needs_reconnect', () => {
    expect(classifyGmailError(makeError(401))).toBe('needs_reconnect');
  });

  it('classifies 404 as not_found', () => {
    expect(classifyGmailError(makeError(404))).toBe('not_found');
  });

  it('classifies 403 insufficientPermissions as needs_reconnect', () => {
    const error = makeError(403, {
      error: { errors: [{ reason: 'insufficientPermissions' }] },
    });
    expect(classifyGmailError(error)).toBe('needs_reconnect');
  });

  it('classifies 403 rateLimitExceeded as rate_limited', () => {
    const error = makeError(403, {
      error: { errors: [{ reason: 'rateLimitExceeded' }] },
    });
    expect(classifyGmailError(error)).toBe('rate_limited');
  });

  it('classifies 403 dailyLimitExceeded as unknown (config issue, not auto-fixable)', () => {
    const error = makeError(403, {
      error: { errors: [{ reason: 'dailyLimitExceeded' }] },
    });
    expect(classifyGmailError(error)).toBe('unknown');
  });

  it('classifies 429 as rate_limited', () => {
    expect(classifyGmailError(makeError(429))).toBe('rate_limited');
  });

  it('classifies 500-599 as rate_limited', () => {
    expect(classifyGmailError(makeError(503))).toBe('rate_limited');
  });

  it('classifies a plain error with no status as unknown', () => {
    expect(classifyGmailError(new Error('boom'))).toBe('unknown');
  });

  it('classifies a GaxiosError from a different installed copy of gaxios (e.g. google-auth-library token refresh), not just googleapis own class', () => {
    // Regression test: an earlier version checked `instanceof
    // Common.GaxiosError`, which only matches googleapis's own gaxios copy.
    // google-auth-library resolves a *different* installed gaxios copy, so a
    // token-refresh failure it throws has a distinct, non-matching class —
    // duck-typing on `.status` must still classify it correctly.
    class UnrelatedGaxiosErrorClass extends Error {
      status?: number;
      response?: { data?: unknown };
    }
    const error = new UnrelatedGaxiosErrorClass('invalid_grant');
    error.status = 401;

    expect(classifyGmailError(error)).toBe('needs_reconnect');
  });
});
