import { describe, it, expect } from '@jest/globals';
import { Common } from 'googleapis';
import { classifyGmailError } from './gmail-error.js';

function makeGaxiosError(status: number, data?: unknown): Common.GaxiosError {
  const err = Object.create(Common.GaxiosError.prototype) as Common.GaxiosError;
  return Object.assign(err, { status, response: { data } });
}

describe('classifyGmailError', () => {
  it('classifies 401 as needs_reconnect', () => {
    expect(classifyGmailError(makeGaxiosError(401))).toBe('needs_reconnect');
  });

  it('classifies 404 as not_found', () => {
    expect(classifyGmailError(makeGaxiosError(404))).toBe('not_found');
  });

  it('classifies 403 insufficientPermissions as needs_reconnect', () => {
    const error = makeGaxiosError(403, {
      error: { errors: [{ reason: 'insufficientPermissions' }] },
    });
    expect(classifyGmailError(error)).toBe('needs_reconnect');
  });

  it('classifies 403 rateLimitExceeded as rate_limited', () => {
    const error = makeGaxiosError(403, {
      error: { errors: [{ reason: 'rateLimitExceeded' }] },
    });
    expect(classifyGmailError(error)).toBe('rate_limited');
  });

  it('classifies 403 dailyLimitExceeded as unknown (config issue, not auto-fixable)', () => {
    const error = makeGaxiosError(403, {
      error: { errors: [{ reason: 'dailyLimitExceeded' }] },
    });
    expect(classifyGmailError(error)).toBe('unknown');
  });

  it('classifies 429 as rate_limited', () => {
    expect(classifyGmailError(makeGaxiosError(429))).toBe('rate_limited');
  });

  it('classifies 500-599 as rate_limited', () => {
    expect(classifyGmailError(makeGaxiosError(503))).toBe('rate_limited');
  });

  it('classifies a non-Gaxios error as unknown', () => {
    expect(classifyGmailError(new Error('boom'))).toBe('unknown');
  });
});
