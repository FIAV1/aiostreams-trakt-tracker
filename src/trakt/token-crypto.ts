import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function keyBytes(secret = process.env.TOKEN_ENCRYPTION_KEY): Buffer {
  if (!secret || secret.length < 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be configured with at least 32 characters');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptToken(value: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = value.split('.');
  if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Stored Trakt token has an unsupported encryption format');
  }
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
}
