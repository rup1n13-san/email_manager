import { describe, it, expect } from '@jest/globals';
import { buildRawEmail } from './mime.js';

function decodeRaw(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf-8');
}

function decodeMimeHeaderValue(value: string): string {
  const match = /^=\?UTF-8\?B\?(.+)\?=$/.exec(value);
  if (!match) return value;
  return Buffer.from(match[1], 'base64').toString('utf-8');
}

describe('buildRawEmail', () => {
  it('produces a base64url string decodable back to the original message', () => {
    const raw = buildRawEmail({
      to: 'someone@example.com',
      subject: 'Hello',
      body: 'Plain body text',
    });

    const decoded = decodeRaw(raw);
    expect(decoded).toContain('To: someone@example.com');
    expect(decoded).toContain('Subject: Hello');
    expect(decoded).toContain('\r\n\r\nPlain body text');
  });

  it('encodes an accented subject as an RFC 2047 encoded-word', () => {
    const raw = buildRawEmail({
      to: 'someone@example.com',
      subject: 'Réunion à confirmer',
      body: 'body',
    });

    const decoded = decodeRaw(raw);
    const subjectLine = decoded
      .split('\r\n')
      .find((line) => line.startsWith('Subject:'))!;
    const value = subjectLine.slice('Subject: '.length);

    expect(value).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    expect(decodeMimeHeaderValue(value)).toBe('Réunion à confirmer');
  });

  it('leaves a plain ASCII subject unencoded', () => {
    const raw = buildRawEmail({
      to: 'someone@example.com',
      subject: 'Plain subject',
      body: 'body',
    });

    const decoded = decodeRaw(raw);
    expect(decoded).toContain('Subject: Plain subject');
  });

  it('preserves accented characters in the body via 8bit UTF-8', () => {
    const raw = buildRawEmail({
      to: 'someone@example.com',
      subject: 'Subject',
      body: 'Merci pour votre réponse, à bientôt.',
    });

    const decoded = decodeRaw(raw);
    expect(decoded).toContain('Merci pour votre réponse, à bientôt.');
    expect(decoded).toContain('Content-Transfer-Encoding: 8bit');
  });

  it('sets the To header to the given recipient', () => {
    const raw = buildRawEmail({
      to: 'recipient@x.com',
      subject: 'S',
      body: 'B',
    });

    const decoded = decodeRaw(raw);
    expect(decoded).toContain('To: recipient@x.com');
  });
});
