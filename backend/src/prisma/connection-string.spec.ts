import { describe, it, expect } from '@jest/globals';
import { buildConnectionString } from './connection-string.js';

describe('buildConnectionString', () => {
  it('returns URL unchanged when no sslMode given', () => {
    const url = 'postgresql://user:pass@localhost:5432/db';
    expect(buildConnectionString(url)).toBe(url);
    expect(buildConnectionString(url, undefined)).toBe(url);
  });

  it('appends sslmode when flag is set', () => {
    const url = 'postgresql://user:pass@localhost:5432/db';
    expect(buildConnectionString(url, 'no-verify')).toBe(
      'postgresql://user:pass@localhost:5432/db?sslmode=no-verify',
    );
  });

  it('appends different sslmode values', () => {
    const url = 'postgresql://user:pass@localhost:5432/db';
    expect(buildConnectionString(url, 'require')).toBe(
      'postgresql://user:pass@localhost:5432/db?sslmode=require',
    );
  });

  it('does not double-append when sslmode already in URL', () => {
    const url = 'postgresql://user:pass@localhost:5432/db?sslmode=disable';
    expect(buildConnectionString(url, 'no-verify')).toBe(url);
  });

  it('handles empty string URL', () => {
    expect(buildConnectionString('', 'no-verify')).toBe('?sslmode=no-verify');
  });
});
