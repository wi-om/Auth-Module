/** Safe diagnostics for product login — never logs passwords or full peppers. */
export function logLoginDebug(event: string, details: Record<string, unknown>): void {
  if (process.env.AUTH_LOGIN_DEBUG !== 'true' && process.env.NODE_ENV !== 'production') {
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(`[auth/login] ${event}`, JSON.stringify(details));
}

export function pepperFingerprint(pepper: string): string {
  if (!pepper) return 'missing';
  return `len=${pepper.length},start=${pepper.slice(0, 4)}***`;
}
