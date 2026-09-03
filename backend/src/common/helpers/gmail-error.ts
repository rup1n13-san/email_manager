import { Common } from 'googleapis';

export type GmailErrorKind =
  'needs_reconnect' | 'not_found' | 'rate_limited' | 'unknown';

export function classifyGmailError(error: unknown): GmailErrorKind {
  if (!(error instanceof Common.GaxiosError)) return 'unknown';

  const status = error.status;
  if (status === 401) return 'needs_reconnect';
  if (status === 404) return 'not_found';

  if (status === 403) {
    const reason = (
      error.response?.data as {
        error?: { errors?: { reason?: string }[] };
      }
    )?.error?.errors?.[0]?.reason;
    if (reason === 'insufficientPermissions') return 'needs_reconnect';
    if (reason === 'rateLimitExceeded') return 'rate_limited';
    return 'unknown';
  }

  if (status === 429 || (status !== undefined && status >= 500)) {
    return 'rate_limited';
  }

  return 'unknown';
}
