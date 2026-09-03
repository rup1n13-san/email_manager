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

export function buildRawEmail({ to, subject, body }: MimeMessageInput): string {
  const headers = [
    `To: ${to}`,
    `Subject: ${encodeMimeHeaderValue(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  const message = `${headers.join('\r\n')}\r\n\r\n${body}`;
  return Buffer.from(message, 'utf-8').toString('base64url');
}
