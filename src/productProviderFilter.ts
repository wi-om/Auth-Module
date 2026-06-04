/** Rules for separating setup-admin OAuth from product (end-user) provider rows. */

export const PRODUCT_SIGN_IN_FLAG = 'productSignIn';

export function isAdminSetupOAuthRedirectUri(uri: string | undefined): boolean {
  if (!uri?.trim()) return false;
  const u = uri.trim();
  return /\/setup\/api\/admin\/oauth\//i.test(u) || /\/setup\/admin\/oauth\//i.test(u);
}

export function isLeakedAdminProductProviderRow(row: {
  provider: string;
  client_id?: string;
  extra_config?: Record<string, string>;
}): boolean {
  if (isAdminSetupOAuthRedirectUri(row.extra_config?.redirectUri)) return true;
  return false;
}

export function hasProductEndUserConfiguration(row: {
  extra_config?: Record<string, string>;
  client_id?: string;
  enabled?: boolean;
}): boolean {
  const extra = row.extra_config || {};
  if (String(extra[PRODUCT_SIGN_IN_FLAG] || '') === 'true') {
    return true;
  }
  const redirect = (extra.redirectUri || '').trim();
  if (redirect && !isAdminSetupOAuthRedirectUri(redirect) && /\/auth\/oauth\//i.test(redirect)) {
    return true;
  }
  if ((row.client_id || '').trim() && redirect && !isAdminSetupOAuthRedirectUri(redirect)) {
    return true;
  }
  return false;
}

function isReservedForAdminOnly(
  providerId: string,
  adminOnly: Set<string>,
  adminAuthProvider: string | null
): boolean {
  const id = providerId.toLowerCase();
  if (adminOnly.has(id)) return true;
  if (adminAuthProvider && id === adminAuthProvider.trim().toLowerCase()) return true;
  return false;
}

function providerIdsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function shouldHideFromEndUserProviderList(
  providerId: string,
  row: { extra_config?: Record<string, string>; client_id?: string; enabled?: boolean },
  adminOnly: Set<string>,
  adminAuthProvider: string | null
): boolean {
  if (hasProductEndUserConfiguration(row)) return false;

  const id = providerId.toLowerCase();
  if (adminOnly.has(id)) return true;
  if (adminAuthProvider && providerIdsMatch(id, adminAuthProvider)) return true;
  return isLeakedAdminProductProviderRow({ provider: providerId, ...row });
}

export function listProductInstalledProviderIds(
  providers: Array<{
    provider: string;
    extra_config?: Record<string, string>;
    client_id?: string;
    enabled?: boolean;
  }>,
  adminOnly: Set<string>,
  adminAuthProvider: string | null
): string[] {
  return providers
    .filter((p) => {
      const id = p.provider.toLowerCase();
      if (isReservedForAdminOnly(id, adminOnly, adminAuthProvider)) return false;
      if (isLeakedAdminProductProviderRow(p)) return false;
      if (id === 'password') return true;
      return hasProductEndUserConfiguration(p);
    })
    .map((p) => String(p.provider).toLowerCase());
}
