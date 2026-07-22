import { Injectable } from '@nestjs/common';

@Injectable()
export class EncryptionHelper {
  // TODO: Implement AES-256-GCM encrypt/decrypt
  encrypt(plaintext: string): string {
    return plaintext;
  }

  decrypt(ciphertext: string): string {
    return ciphertext;
  }
}
