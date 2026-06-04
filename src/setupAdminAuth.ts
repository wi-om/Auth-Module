import crypto from 'crypto';
import { Pool } from 'pg';
import { config } from './config';
import { ensureAdminAuthSchema } from './adminAuthSchema';
import { issueAdminToken, type AdminRow } from './adminAuth';
import { countAdmins, getAuthSetting, setAuthSetting } from './bootstrapDb';
import { listPluginCatalog } from './pluginCatalog';
import {
  buildOAuthAuthorizeUrl,
  exchangeAuthorizationCode,
  fetchOAuthUserProfile,
  isOAuthPrototypeMode,
  mapProfileToUser,
  createPrototypeOAuthSession,
} from './auth/oauthAdapter';
import { consumeOAuthState, saveOAuthState } from './auth/oauthStateStore';
import type { PluginRecord } from './plugin/pluginRegistry';
import { registerAdminPluginInRuntime, upsertAdminPluginFromCatalog } from './adminPluginStore';
import { invalidateAdminProductSeparation } from './adminProductSeparationCache';
import type { OAuthPluginManifest } from './plugin/manifestSchema';
import { readExamplePluginManifest, exampleFilenameForPlugin } from './pluginCatalog';
import {
  getAdminOAuthConfig,
  enforceAdminProductStorageSeparation,
  purgeEndUserProviderSettingsForAdminOAuth,
  resolveAdminAuthProviderId,
  upsertAdminOAuthConfig,
} from './adminOAuthConfig';
export { resolveAdminAuthProviderId } from './adminOAuthConfig';
import { ensurePasswordProvider } from './setupPluginPersistence';
import { resolvePluginRedirectUri } from './plugin/oauthRedirectUri';
import {
  hasProductEndUserConfiguration,
  isAdminSetupOAuthRedirectUri,
  isLeakedAdminProductProviderRow,
  listProductInstalledProviderIds,
  shouldHideFromEndUserProviderList,
} from './productProviderFilter';
export {
  hasProductEndUserConfiguration,
  isAdminSetupOAuthRedirectUri,
  isLeakedAdminProductProviderRow,
  listProductInstalledProviderIds,
  shouldHideFromEndUserProviderList,
} from './productProviderFilter';
import { resolveSetupAdminOAuthRedirectUri } from './setupAdminRedirect';
import { clearSetupResumeAfterAdminCreated } from './setupResumeAuth';
import { loadSetupConfigHydrated, type SetupConfig } from './setupStore';
import type { ProviderSettingPublic } from './providerSettings';

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

const ADMIN_AUTH_PROVIDER_KEY = 'admin_auth_provider';

export async function getAdminAuthProviderId(databaseUrl: string): Promise<string | null> {
  const stored = await getAuthSetting<{ provider?: string }>(databaseUrl, ADMIN_AUTH_PROVIDER_KEY);
  const id = stored?.provider?.trim().toLowerCase();
  return id || null;
}

/** Admin OAuth manifest from auth_admin_plugins (never auth_provider_plugins). */
export async function ensureAdminOAuthPluginInRuntime(
  setup: SetupConfig,
  providerId: string
): Promise<PluginRecord | null> {
  return registerAdminPluginInRuntime(setup, providerId);
}

function providerIdsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Strip admin-only OAuth from end-user provider list (setup step 3 / public sign-in). */
export function maskAdminOnlyProviderForEndUsers<
  T extends {
    provider: string;
    enabled: boolean;
    client_id: string;
    client_secret: string;
    extra_config?: Record<string, string>;
  },
>(providers: T[], adminProvider: string | null): T[] {
  return providers.map((p) => {
    const pid = p.provider.toLowerCase();
    const isAdminProvider = Boolean(adminProvider && providerIdsMatch(pid, adminProvider));
    const leakedAdminRedirect = isLeakedAdminProductProviderRow(p);
    if (!isAdminProvider && !leakedAdminRedirect) return p;

    const productRedirect = resolvePluginRedirectUri(p.provider);
    return {
      ...p,
      enabled: false,
      client_id: '',
      client_secret: '',
      extra_config: { redirectUri: productRedirect },
    };
  });
}

/** Migrate legacy leaks and ensure admin OAuth lives only in auth_admin_* tables. */
export async function ensureProductProviderRowSeparatedFromAdmin(
  setup: SetupConfig
): Promise<string | null> {
  await enforceAdminProductStorageSeparation(setup);
  return resolveAdminAuthProviderId(setup.databaseUrl, setup.companyId);
}

export async function repairProductRowIfAdminOAuthLeak(setup: SetupConfig): Promise<boolean> {
  await enforceAdminProductStorageSeparation(setup);
  return true;
}

async function loadAdminOAuthSetting(
  setup: SetupConfig,
  providerId: string
): Promise<ProviderSettingPublic | null> {
  const provider = providerId.toLowerCase();
  const row = await getAdminOAuthConfig(setup.databaseUrl, setup.companyId, provider);
  if (!row?.client_id?.trim() || !row?.client_secret?.trim()) {
    return null;
  }

  const plugin = await ensureAdminOAuthPluginInRuntime(setup, provider);
  if (!plugin || plugin.manifest.type !== 'oauth') {
    return null;
  }

  const base: ProviderSettingPublic = {
    provider,
    label: plugin.label,
    type: 'oauth',
    source: 'plugin',
    enabled: true,
    clientId: row.client_id,
    hasClientSecret: true,
    clientSecretMasked: row.client_secret,
    extraConfig: (row.extra_config || {}) as Record<string, string>,
    configured: true,
    pluginVersion: plugin.version,
  };
  return settingForAdminOAuth(provider, base);
}

export async function listAdminRegisterOptions(): Promise<AdminAuthOption[]> {
  const catalog = listPluginCatalog();
  return catalog
    .filter((p) => p.plugin_type === 'password' || p.plugin_type === 'oauth')
    .map((p) => ({
      id: p.id,
      label: p.label,
      type: p.plugin_type === 'password' ? 'password' : 'oauth',
    }));
}

export async function getAdminLoginMethod(databaseUrl: string): Promise<AdminLoginMethod | null> {
  await ensureAdminAuthSchema(databaseUrl);
  const stored = await getAuthSetting<{ provider?: string }>(databaseUrl, ADMIN_AUTH_PROVIDER_KEY);
  if (stored?.provider) {
    const catalog = listPluginCatalog();
    const match = catalog.find((c) => c.id === stored.provider);
    return {
      provider: stored.provider,
      label: match?.label || stored.provider,
      type: stored.provider === 'password' ? 'password' : 'oauth',
    };
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const r = await pool.query<{ auth_provider: string }>(
      `SELECT auth_provider FROM auth_admins ORDER BY created_at ASC LIMIT 1`
    );
    const provider = r.rows[0]?.auth_provider || 'password';
    const catalog = listPluginCatalog();
    const match = catalog.find((c) => c.id === provider);
    return {
      provider,
      label: match?.label || provider,
      type: provider === 'password' ? 'password' : 'oauth',
    };
  } finally {
    await pool.end();
  }
}

export async function setAdminAuthProviderSetting(
  databaseUrl: string,
  provider: string
): Promise<void> {
  await setAuthSetting(databaseUrl, ADMIN_AUTH_PROVIDER_KEY, { provider });
}

export async function prepareAdminOAuthProvider(
  setup: SetupConfig,
  input: {
    provider: string;
    clientId: string;
    clientSecret: string;
    tenantId?: string;
  }
): Promise<void> {
  const provider = input.provider.toLowerCase();
  if (provider === 'password') {
    throw new Error('Use email registration for password admin');
  }

  await upsertAdminOAuthConfig(setup, input);
  invalidateAdminProductSeparation(setup);
  await upsertAdminPluginFromCatalog(setup, provider);
  await purgeEndUserProviderSettingsForAdminOAuth(setup, provider);
  await enforceAdminProductStorageSeparation(setup, { force: true });
  await setAdminAuthProviderSetting(setup.databaseUrl, provider);
  const { reloadProductRuntimeFromSetup } = await import('./runtimeSync');
  await reloadProductRuntimeFromSetup();
  await registerAdminPluginInRuntime(setup, provider);
}

function settingForAdminOAuth(provider: string, setting: ProviderSettingPublic): ProviderSettingPublic {
  return {
    ...setting,
    redirectUri: resolveSetupAdminOAuthRedirectUri(provider),
    extraConfig: {
      ...setting.extraConfig,
      redirectUri: resolveSetupAdminOAuthRedirectUri(provider),
    },
  };
}

export async function startAdminOAuth(
  mode: 'register' | 'login',
  providerId: string
): Promise<{ redirectUrl?: string; accessToken?: string; label: string }> {
  const setup = await loadSetupConfigHydrated();
  if (!setup?.databaseUrl) {
    throw new Error('Database connection is not configured');
  }
  await ensureAdminAuthSchema(setup.databaseUrl);

  const provider = providerId.toLowerCase();
  if (provider === 'password') {
    throw new Error('Password admin does not use OAuth start');
  }

  if (mode === 'register') {
    const adminCount = await countAdmins(setup.databaseUrl);
    if (adminCount > 0) {
      throw new Error('An admin account already exists');
    }
  } else {
    const adminCount = await countAdmins(setup.databaseUrl);
    if (adminCount === 0) {
      throw new Error('No admin account exists');
    }
    const method = await getAdminLoginMethod(setup.databaseUrl);
    if (method?.provider !== provider) {
      throw new Error(`This organization uses ${method?.label || method?.provider} for admin sign-in`);
    }
  }

  const setting = await loadAdminOAuthSetting(setup, provider);
  if (!setting?.clientId?.trim()) {
    throw new Error('Configure Client ID and secret for admin sign-in before continuing');
  }
  if (!setting.hasClientSecret) {
    throw new Error('Client secret is required');
  }

  const plugin = await ensureAdminOAuthPluginInRuntime(setup, provider);
  if (!plugin || plugin.manifest.type !== 'oauth') {
    throw new Error(`OAuth plugin "${provider}" is not available for admin sign-in.`);
  }

  const oauthSetting = setting;

  if (isOAuthPrototypeMode()) {
    const session = createPrototypeOAuthSession(provider, setting.label);
    const accessToken = await finishAdminOAuthFromProfile(
      mode,
      provider,
      {
        email: session.user!.email,
        name: session.user!.name,
        subject: session.user!.id,
      },
      setup
    );
    return { accessToken, label: setting.label };
  }

  const state = crypto.randomBytes(24).toString('hex');
  saveOAuthState(state, provider, mode === 'register' ? 'admin_register' : 'admin_login');
  const redirectUrl = buildOAuthAuthorizeUrl(plugin.manifest as OAuthPluginManifest, oauthSetting, state);
  return { redirectUrl, label: setting.label };
}

export async function completeAdminOAuthCallback(
  providerId: string,
  code: string,
  state: string
): Promise<{ accessToken: string; admin: { id: string; email: string }; mode: 'register' | 'login' }> {
  const setup = await loadSetupConfigHydrated();
  if (!setup?.databaseUrl) {
    throw new Error('Database connection is not configured');
  }

  const provider = providerId.toLowerCase();
  const consumedPurpose = consumeOAuthState(state, provider);
  if (!consumedPurpose || (consumedPurpose !== 'admin_register' && consumedPurpose !== 'admin_login')) {
    throw new Error('Invalid or expired OAuth state');
  }
  const mode = consumedPurpose === 'admin_register' ? 'register' : 'login';

  const setting = await loadAdminOAuthSetting(setup, provider);
  if (!setting?.hasClientSecret) {
    throw new Error('Admin OAuth client secret is not configured');
  }
  const plugin = await ensureAdminOAuthPluginInRuntime(setup, provider);
  if (!plugin || plugin.manifest.type !== 'oauth') {
    throw new Error('Invalid OAuth provider');
  }

  const oauthSetting = setting;
  const clientSecret = setting.clientSecretMasked;
  const idpToken = await exchangeAuthorizationCode(
    plugin.manifest as OAuthPluginManifest,
    oauthSetting,
    clientSecret,
    code
  );
  const profile = await fetchOAuthUserProfile(plugin.manifest as OAuthPluginManifest, idpToken);
  const user = mapProfileToUser(plugin.manifest as OAuthPluginManifest, provider, setting.label, profile);

  const accessToken = await finishAdminOAuthFromProfile(
    mode,
    provider,
    { email: user.email, name: user.name, subject: user.id },
    setup
  );

  const pool = new Pool({ connectionString: setup.databaseUrl });
  try {
    const r = await pool.query<{ id: string; email: string }>(
      `SELECT id, email FROM auth_admins WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [user.email]
    );
    return { accessToken, admin: r.rows[0], mode };
  } finally {
    await pool.end();
  }
}

async function finishAdminOAuthFromProfile(
  mode: 'register' | 'login',
  provider: string,
  profile: { email: string; name: string; subject: string },
  setup: SetupConfig
): Promise<string> {
  await ensureAdminAuthSchema(setup.databaseUrl);
  const email = profile.email.trim().toLowerCase();
  const pool = new Pool({ connectionString: setup.databaseUrl });

  try {
    if (mode === 'register') {
      const adminCount = await countAdmins(setup.databaseUrl);
      if (adminCount > 0) {
        throw new Error('An admin account already exists');
      }
      const adminId = crypto.randomUUID();
      const insert = await pool.query<AdminRow>(
        `INSERT INTO auth_admins (id, email, password_hash, auth_provider, oauth_subject)
         VALUES ($1, $2, NULL, $3, $4)
         RETURNING id, email, password_hash`,
        [adminId, email, provider, profile.subject]
      );
      await setAdminAuthProviderSetting(setup.databaseUrl, provider);
      await ensurePasswordProvider(setup);
      await ensureProductProviderRowSeparatedFromAdmin(setup);
      await clearSetupResumeAfterAdminCreated();
      return issueAdminToken(insert.rows[0], setup);
    }

    const result = await pool.query<AdminRow>(
      `SELECT id, email, password_hash, auth_provider, oauth_subject FROM auth_admins
       WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    const admin = result.rows[0];
    if (!admin) {
      throw new Error('No admin account for this email');
    }
    if (admin.auth_provider !== provider) {
      throw new Error('Sign in with the provider configured for this admin account');
    }
    return issueAdminToken(admin, setup);
  } finally {
    await pool.end();
  }
}
