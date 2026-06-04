export type BootstrapPhase = 'connection' | 'register' | 'setup' | 'complete';

export type DbMode = 'product' | 'auth_only';

export type AdminAuthOption = {
  id: string;
  label: string;
  type: 'password' | 'oauth' | 'passkey';
};

export type AdminLoginMethod = {
  provider: string;
  label: string;
  type: 'password' | 'oauth';
};

export type BootstrapStatus = {
  phase: BootstrapPhase;
  dbConnected: boolean;
  hasAdmin: boolean;
  setupComplete: boolean;
  dbMode: DbMode | null;
  companyId: string | null;
  adminLoginMethod?: AdminLoginMethod | null;
  resumePasswordConfigured: boolean;
  resumeRequired: boolean;
  resumeSessionValid?: boolean;
};

export type ConnectionPayload = {
  dbMode: DbMode;
  databaseUrl?: string;
  host?: string;
  port?: string;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
};

export type ConnectionTestResult = {
  message: string;
  migrated?: boolean;
  warnings?: string[];
  missingTables?: string[];
  error?: string;
};

export type ProviderRow = {
  provider: string;
  enabled: boolean;
  client_id: string;
  client_secret?: string;
  extra_config?: Record<string, string>;
};

export type PluginRow = {
  id: string;
  label: string;
  version: string;
  plugin_type: 'oauth' | 'passkey';
};

export type ProvidersResponse = {
  providers: ProviderRow[];
  plugins: PluginRow[];
  /** Provider id used only for setup-wizard admin sign-in (not end users). */
  adminAuthProvider?: string | null;
  /** All provider ids reserved for setup admin OAuth (excluded from end-user list). */
  adminOnlyProviderIds?: string[];
  error?: string;
};

export function isAdminSetupRedirectUri(uri: string | undefined): boolean {
  if (!uri?.trim()) return false;
  const u = uri.trim();
  return /\/setup\/api\/admin\/oauth\//i.test(u) || /\/setup\/admin\/oauth\//i.test(u);
}

const PRODUCT_SIGN_IN_FLAG = 'productSignIn';

/** Product plugin row (end-user sign-in) — not setup admin OAuth. */
export function hasProductEndUserConfiguration(row: ProviderRow): boolean {
  const extra = row.extra_config || {};
  if (String(extra[PRODUCT_SIGN_IN_FLAG] || '') === 'true') {
    return true;
  }
  const redirect = (extra.redirectUri || '').trim();
  if (redirect && !isAdminSetupRedirectUri(redirect) && /\/auth\/oauth\//i.test(redirect)) {
    return true;
  }
  if ((row.client_id || '').trim() && redirect && !isAdminSetupRedirectUri(redirect)) {
    return true;
  }
  return false;
}

export function isAdminOnlyProductProvider(
  providerId: string,
  row: ProviderRow,
  adminAuthProvider?: string | null,
  adminOnlyProviderIds?: string[]
): boolean {
  if (hasProductEndUserConfiguration(row)) return false;

  const id = providerId.toLowerCase();
  if (adminOnlyProviderIds?.some((p) => p.toLowerCase() === id)) return true;
  if (adminAuthProvider && id === String(adminAuthProvider).toLowerCase()) return true;
  return isAdminSetupRedirectUri(row.extra_config?.redirectUri);
}

export type CatalogPlugin = {
  id: string;
  label: string;
  version: string;
  plugin_type: 'oauth' | 'passkey' | 'password';
  description?: string;
};

export type PluginCatalogResponse = {
  catalog: CatalogPlugin[];
  installedIds: string[];
};
