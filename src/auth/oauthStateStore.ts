const TTL_MS = 10 * 60 * 1000;

export type OAuthStatePurpose = 'product' | 'admin_register' | 'admin_login';

type PendingOAuth = {
  provider: string;
  purpose: OAuthStatePurpose;
  createdAt: number;
};

const pending = new Map<string, PendingOAuth>();

export function saveOAuthState(
  state: string,
  provider: string,
  purpose: OAuthStatePurpose = 'product'
): void {
  pending.set(state, { provider, purpose, createdAt: Date.now() });
}

export function consumeOAuthState(
  state: string,
  provider: string,
  expectedPurpose?: OAuthStatePurpose
): OAuthStatePurpose | null {
  const entry = pending.get(state);
  if (!entry) return null;
  pending.delete(state);
  if (entry.provider !== provider) return null;
  if (expectedPurpose && entry.purpose !== expectedPurpose) return null;
  if (Date.now() - entry.createdAt > TTL_MS) return null;
  return entry.purpose;
}
