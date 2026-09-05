export interface MimeMessageInput {
  to: string;
  subject: string;
  body: string;
}

function isAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

function encodeMimeHeaderValue(value: string): string {
  if (isAscii(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

// RFC 2047 encoded-words may only wrap the display-name phrase, never the
// <addr-spec> — encoding the whole "Name <addr>" string would make the
// address unparseable. Only the name (if present) gets encoded.
function encodeAddressHeader(value: string): string {
  const match = /^(.*)<([^<>]+)>\s*$/.exec(value.trim());
  if (!match) return encodeMimeHeaderValue(value);

  const [, rawName, address] = match;
  const displayName = rawName.trim().replace(/^"(.*)"$/, '$1');
  return displayName
    ? `${encodeMimeHeaderValue(displayName)} <${address.trim()}>`
    : `<${address.trim()}>`;
}

export function buildRawEmail({ to, subject, body }: MimeMessageInput): string {
  const safeTo = to.replace(/[\r\n]+/g, ' ').trim();
  const safeSubject = subject.replace(/[\r\n]+/g, ' ').trim();
  const headers = [
    `To: ${encodeAddressHeader(safeTo)}`,
    `Subject: ${encodeMimeHeaderValue(safeSubject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  const message = `${headers.join('\r\n')}\r\n\r\n${body}`;
  return Buffer.from(message, 'utf-8').toString('base64url');
}
