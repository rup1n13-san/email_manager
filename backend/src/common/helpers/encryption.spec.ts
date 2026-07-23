import { EncryptionHelper } from './encryption.js';

const VALID_KEY =
  '0992b7c6d936d9071b4e285b1794cf935a2b5a5a163c7ef1dc21c31c572960e7';

describe('EncryptionHelper', () => {
  let originalKey: string | undefined;

  beforeAll(() => {
    originalKey = process.env.ENCRYPTION_KEY;
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalKey;
  });

  describe('constructor key validation', () => {
    it('throws when ENCRYPTION_KEY is missing', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => new EncryptionHelper()).toThrow(
        'ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
      );
    });

    it('throws when ENCRYPTION_KEY is too short', () => {
      process.env.ENCRYPTION_KEY = 'not-64-chars';
      expect(() => new EncryptionHelper()).toThrow(
        'ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
      );
    });

    it('throws when ENCRYPTION_KEY has non-hex characters', () => {
      process.env.ENCRYPTION_KEY = 'z'.repeat(64);
      expect(() => new EncryptionHelper()).toThrow(
        'ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
      );
    });

    it('accepts a valid 64-char hex key', () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;
      expect(() => new EncryptionHelper()).not.toThrow();
    });
  });

  describe('encrypt/decrypt', () => {
    let helper: EncryptionHelper;

    beforeAll(() => {
      process.env.ENCRYPTION_KEY = VALID_KEY;
      helper = new EncryptionHelper();
    });

    it('round-trips a plaintext string', () => {
      const plaintext = 'hello world';
      const encrypted = helper.encrypt(plaintext);
      const decrypted = helper.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('round-trips an empty string', () => {
      const encrypted = helper.encrypt('');
      const decrypted = helper.decrypt(encrypted);
      expect(decrypted).toBe('');
    });

    it('round-trips a long string', () => {
      const plaintext = 'a'.repeat(10000);
      const encrypted = helper.encrypt(plaintext);
      const decrypted = helper.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('round-trips special characters and unicode', () => {
      const plaintext = 'héllo wörld ✓ 你好 🎉';
      const encrypted = helper.encrypt(plaintext);
      const decrypted = helper.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertext for the same plaintext (unique IV)', () => {
      const plaintext = 'same text';
      const result1 = helper.encrypt(plaintext);
      const result2 = helper.encrypt(plaintext);
      expect(result1).not.toBe(result2);
    });
  });

  describe('tamper detection', () => {
    let helper: EncryptionHelper;

    beforeAll(() => {
      process.env.ENCRYPTION_KEY = VALID_KEY;
      helper = new EncryptionHelper();
    });

    it('throws on corrupted ciphertext (wrong IV)', () => {
      const encrypted = helper.encrypt('secret data');
      const parts = encrypted.split(':');
      const tag = parts[1];
      const data = parts[2];
      const corrupted = `ffffffffffffffffffffffff:${tag}:${data}`;
      expect(() => helper.decrypt(corrupted)).toThrow();
    });

    it('throws on corrupted ciphertext (wrong auth tag)', () => {
      const encrypted = helper.encrypt('secret data');
      const [iv, , data] = encrypted.split(':');
      const corrupted = `${iv}:ffffffffffffffffffffffffffffffff:${data}`;
      expect(() => helper.decrypt(corrupted)).toThrow();
    });

    it('throws on corrupted ciphertext (wrong data)', () => {
      const encrypted = helper.encrypt('secret data');
      const [iv, tag] = encrypted.split(':');
      const corrupted = `${iv}:${tag}:deadbeef`;
      expect(() => helper.decrypt(corrupted)).toThrow();
    });

    it('throws on malformed payload (wrong part count)', () => {
      expect(() => helper.decrypt('too:few')).toThrow(
        'Invalid encrypted payload format',
      );
      expect(() => helper.decrypt('too:many:parts:here')).toThrow(
        'Invalid encrypted payload format',
      );
    });

    it('throws on empty string', () => {
      expect(() => helper.decrypt('')).toThrow(
        'Invalid encrypted payload format',
      );
    });
  });
});
