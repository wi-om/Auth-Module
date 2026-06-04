import crypto from 'crypto';

export function hashClientHashedPassword(
  clientHashedPassword: string,
  salt: string,
  pepper: string
): string {
  return crypto
    .createHash('sha256')
    .update(`${clientHashedPassword}${salt}${pepper}`)
    .digest('hex');
}

export function compareClientHashedPassword(
  clientHashedPassword: string,
  salt: string,
  storedHash: string,
  pepper: string
): boolean {
  const candidate = hashClientHashedPassword(clientHashedPassword, salt, pepper);
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
