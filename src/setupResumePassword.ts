/** Client sends SHA-256(password) as 64-char hex; server stores scrypt(hex + pepper, salt). */

export const CLIENT_HASH_HEX = /^[a-f0-9]{64}$/i;

export function assertClientHashedPassword(value: unknown, field = 'clientHashedPassword'): string {
  const hash = String(value || '').trim().toLowerCase();
  if (!CLIENT_HASH_HEX.test(hash)) {
    throw new Error(`${field} must be a 64-character hex SHA-256 hash`);
  }
  return hash;
}
