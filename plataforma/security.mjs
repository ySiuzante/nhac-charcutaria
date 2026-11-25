import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);

export const token = () => randomBytes(32).toString('base64url');
export const hashToken = value => createHash('sha256').update(value).digest('hex');
export const validEmail = email => typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const normalizeEmail = email => email.trim().toLowerCase();
export const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128 && Buffer.byteLength(value) <= 256;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 256 || typeof stored !== 'string') return false;
  const [algorithm, salt, hex] = stored.split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hex || '')) return false;
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(derived, Buffer.from(hex, 'hex'));
}
export function getEncryptionKey() {
  const value = process.env.NHAC_TOTP_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('Defina NHAC_TOTP_KEY com 64 caracteres hexadecimais.');
  return Buffer.from(value, 'hex');
}
export function encryptSecret(secret, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(x => x.toString('hex')).join(':');
}
export function decryptSecret(encoded, key) {
  const [iv, tag, data] = encoded.split(':').map(x => Buffer.from(x, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes) {
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { result += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function fromBase32(secret) {
  let bits = 0, value = 0; const bytes = [];
  for (const char of secret) { const n = alphabet.indexOf(char); if (n < 0) throw new Error('Segredo TOTP inválido'); value = (value << 5) | n; bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(bytes);
}
export function totp(secret, counter = Math.floor(Date.now() / 30000)) {
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', fromBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function totpCounter(secret, code, lastCounter = -1) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const now = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].map(offset => now + offset).find(counter => counter > lastCounter && timingSafeEqual(Buffer.from(totp(secret, counter)), Buffer.from(code))) ?? null;
}
