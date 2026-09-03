export type GmailErrorKind =
  'needs_reconnect' | 'not_found' | 'rate_limited' | 'unknown';

interface GaxiosLikeError {
  status: number;
  response?: { data?: unknown };
}

// Duck-typed rather than `instanceof GaxiosError`: googleapis and
// google-auth-library resolve to two separately-installed gaxios copies, so
// their GaxiosError classes are not the same identity and instanceof fails
// across that boundary (e.g. a token-refresh failure thrown by
// google-auth-library would never match googleapis's own GaxiosError class).
function isGaxiosLikeError(error: unknown): error is GaxiosLikeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { status?: unknown }).status === 'number'
  );
}

export function classifyGmailError(error: unknown): GmailErrorKind {
  if (!isGaxiosLikeError(error)) return 'unknown';

  const { status } = error;
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

  if (status === 429 || status >= 500) {
    return 'rate_limited';
  }

  return 'unknown';
}
