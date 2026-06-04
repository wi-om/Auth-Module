import crypto from 'crypto';
import { getPluginById, listPlugins, pluginExists } from './plugin/pluginRegistry';
import { resolvePluginRedirectUri } from './plugin/oauthRedirectUri';
import type { PluginConfigField, ProviderPluginManifest } from './plugin/manifestSchema';

export const BUILTIN_PASSWORD_PROVIDER = 'password';

export type ProviderSettingRow = {
  provider: string;
  enabled: boolean;
  client_id: string;
  client_secret: string;
  extra_config: Record<string, string>;
};

export type ProviderSettingPublic = {
  provider: string;
  label: string;
  type: 'password' | 'oauth' | 'passkey';
  source: 'builtin' | 'plugin';
  enabled: boolean;
  clientId: string;
  hasClientSecret: boolean;
  clientSecretMasked: string;
  extraConfig: Record<string, string>;
  configured: boolean;
  pluginVersion?: string;
  configFields?: PluginConfigField[];
  /** Read-only: authorize query params from plugin manifest (not editable in admin UI). */
  extraAuthorizeParams?: Record<string, string>;
  /** Computed by auth service from plugin id + OAUTH_CALLBACK_BASE_URL (read-only for admin UI). */
  redirectUri?: string;
};

export type ProviderOptionPublic = {
  id: string;
  label: string;
  type: 'password' | 'oauth' | 'passkey';
  /** False when OAuth is enabled but Client ID / secret are missing */
  configured?: boolean;
};

export const REDIRECT_URI_CONFIG_KEY = 'redirectUri';

function filterConfigFields(fields?: PluginConfigField[]): PluginConfigField[] | undefined {
  if (!fields?.length) return fields;
  const filtered = fields.filter((f) => f.key !== REDIRECT_URI_CONFIG_KEY);
  return filtered.length ? filtered : undefined;
}

export function defaultRedirectUriForProvider(providerId: string): string {
  return resolvePluginRedirectUri(providerId);
}

function effectiveRedirectUri(providerId: string, extraConfig: Record<string, string> | undefined): string {
  const stored = String(extraConfig?.[REDIRECT_URI_CONFIG_KEY] || '').trim();
  return stored || defaultRedirectUriForProvider(providerId);
}

function withDefaultOAuthExtraConfig(
  providerId: string,
  type: 'password' | 'oauth' | 'passkey',
  extraConfig: Record<string, string>
): Record<string, string> {
  if (type !== 'oauth') return extraConfig;
  return {
    ...extraConfig,
    [REDIRECT_URI_CONFIG_KEY]: effectiveRedirectUri(providerId, extraConfig),
  };
}

function rowToPublic(
  row: ProviderSettingRow,
  meta: {
    label: string;
    type: 'password' | 'oauth' | 'passkey';
    source: 'builtin' | 'plugin';
    pluginVersion?: string;
    configFields?: PluginConfigField[];
    extraAuthorizeParams?: Record<string, string>;
  },
  includeSecret = false
): ProviderSettingPublic {
  const isOAuth = meta.type === 'oauth';
  const redirectUri = isOAuth ? effectiveRedirectUri(row.provider, row.extra_config) : '';
  const configured =
    meta.type === 'passkey' || meta.type === 'password'
      ? true
      : Boolean(row.client_id.trim() && row.client_secret.trim());

  return {
    provider: row.provider,
    label: meta.label,
    type: meta.type,
    source: meta.source,
    enabled: row.enabled,
    clientId: row.client_id,
    hasClientSecret: Boolean(row.client_secret.trim()),
    clientSecretMasked: includeSecret
      ? row.client_secret
      : row.client_secret.trim()
        ? '••••••••••••'
        : '',
    extraConfig: row.extra_config || {},
    configured,
    pluginVersion: meta.pluginVersion,
    configFields: filterConfigFields(meta.configFields),
    extraAuthorizeParams: meta.extraAuthorizeParams,
    redirectUri: isOAuth ? redirectUri : undefined,
  };
}

export function isProviderReady(setting: ProviderSettingPublic): boolean {
  if (!setting.enabled) return false;
  if (setting.type === 'password' || setting.type === 'passkey') return true;
  return setting.configured;
}

export async function isKnownProvider(provider: string): Promise<boolean> {
  if (provider === BUILTIN_PASSWORD_PROVIDER) return true;
  return pluginExists(provider);
}

const settingsByProvider = new Map<string, ProviderSettingRow>();

export async function ensurePasswordProviderRow(): Promise<void> {
  if (!settingsByProvider.has(BUILTIN_PASSWORD_PROVIDER)) {
    settingsByProvider.set(BUILTIN_PASSWORD_PROVIDER, {
      provider: BUILTIN_PASSWORD_PROVIDER,
      enabled: true,
      client_id: '',
      client_secret: '',
      extra_config: {},
    });
  }
}

export async function backfillOAuthRedirectUris(): Promise<void> {
  const plugins = await listPlugins();
  for (const plugin of plugins) {
    if (plugin.manifest.type !== 'oauth') continue;
    const row = await getSettingsRow(plugin.id);
    if (!row) {
      settingsByProvider.set(plugin.id, {
        provider: plugin.id,
        enabled: false,
        client_id: '',
        client_secret: '',
        extra_config: { [REDIRECT_URI_CONFIG_KEY]: defaultRedirectUriForProvider(plugin.id) },
      });
      continue;
    }
    const next = withDefaultOAuthExtraConfig(plugin.id, 'oauth', row.extra_config || {});
    if (next[REDIRECT_URI_CONFIG_KEY] === row.extra_config?.[REDIRECT_URI_CONFIG_KEY]) continue;
    settingsByProvider.set(plugin.id, { ...row, extra_config: next });
  }
}

export async function seedDefaultProviderSettings(_defaultEnabled: string[]): Promise<void> {
  await ensurePasswordProviderRow();
  await backfillOAuthRedirectUris();
  const row = settingsByProvider.get(BUILTIN_PASSWORD_PROVIDER);
  if (row) settingsByProvider.set(BUILTIN_PASSWORD_PROVIDER, { ...row, enabled: true });
  await syncRuntimeEnabledProviders();
}

async function syncRuntimeEnabledProviders(): Promise<void> {
  void crypto.randomUUID();
  // no-op in stateless mode (runtime config lives in memory)
}

async function getSettingsRow(provider: string): Promise<ProviderSettingRow | null> {
  return settingsByProvider.get(provider) || null;
}

async function resolveProviderMeta(provider: string): Promise<{
  label: string;
  type: 'password' | 'oauth' | 'passkey';
  source: 'builtin' | 'plugin';
  pluginVersion?: string;
    configFields?: PluginConfigField[];
    extraAuthorizeParams?: Record<string, string>;
    manifest?: ProviderPluginManifest;
  } | null> {
  if (provider === BUILTIN_PASSWORD_PROVIDER) {
    return {
      label: 'Email & Password',
      type: 'password',
      source: 'builtin',
    };
  }

  const plugin = await getPluginById(provider);
  if (!plugin) return null;

  if (plugin.manifest.type === 'passkey') {
    return {
      label: plugin.label,
      type: 'passkey',
      source: 'plugin',
      pluginVersion: plugin.version,
      configFields: plugin.manifest.configFields,
      manifest: plugin.manifest,
    };
  }

  return {
    label: plugin.label,
    type: 'oauth',
    source: 'plugin',
    pluginVersion: plugin.version,
    configFields: plugin.manifest.configFields,
    extraAuthorizeParams: plugin.manifest.oauth.extraAuthorizeParams,
    manifest: plugin.manifest,
  };
}

export async function getAllProviderSettings(includeSecrets = false): Promise<ProviderSettingPublic[]> {
  await ensurePasswordProviderRow();

  const plugins = await listPlugins();
  const settings: ProviderSettingPublic[] = [];

  const passwordRow = await getSettingsRow(BUILTIN_PASSWORD_PROVIDER);
  if (passwordRow) {
    settings.push(
      rowToPublic(
        passwordRow,
        { label: 'Email & Password', type: 'password', source: 'builtin' },
        includeSecrets
      )
    );
  }

  for (const plugin of plugins) {
    let row = await getSettingsRow(plugin.id);
    if (!row) {
      const initialExtra: Record<string, string> =
        plugin.manifest.type === 'oauth'
          ? { [REDIRECT_URI_CONFIG_KEY]: defaultRedirectUriForProvider(plugin.id) }
          : {};
      settingsByProvider.set(plugin.id, {
        provider: plugin.id,
        enabled: false,
        client_id: '',
        client_secret: '',
        extra_config: initialExtra,
      });
      row = await getSettingsRow(plugin.id);
    } else if (plugin.manifest.type === 'oauth') {
      const next = withDefaultOAuthExtraConfig(plugin.id, 'oauth', row.extra_config || {});
      if (next[REDIRECT_URI_CONFIG_KEY] !== row.extra_config?.[REDIRECT_URI_CONFIG_KEY]) {
        settingsByProvider.set(plugin.id, { ...row, extra_config: next });
        row = await getSettingsRow(plugin.id);
      }
    }
    if (!row) continue;

    const pluginMeta =
      plugin.manifest.type === 'passkey'
        ? {
            label: plugin.label,
            type: 'passkey' as const,
            source: 'plugin' as const,
            pluginVersion: plugin.version,
            configFields: plugin.manifest.configFields,
          }
        : {
            label: plugin.label,
            type: 'oauth' as const,
            source: 'plugin' as const,
            pluginVersion: plugin.version,
            configFields: plugin.manifest.configFields,
            extraAuthorizeParams: plugin.manifest.oauth.extraAuthorizeParams,
          };

    settings.push(rowToPublic(row, pluginMeta, includeSecrets));
  }

  return settings;
}

export async function getReadyProviderIds(): Promise<string[]> {
  const settings = await getAllProviderSettings();
  return settings.filter(isProviderReady).map((s) => s.provider);
}

export async function getPublicAuthOptions(): Promise<ProviderOptionPublic[]> {
  const settings = await getAllProviderSettings();
  return settings
    .filter((s) => s.enabled)
    .map((s) => ({
      id: s.provider,
      label: s.label,
      type: s.type,
      configured: isProviderReady(s),
    }));
}

export async function getProviderSetting(
  provider: string,
  includeSecrets = false
): Promise<ProviderSettingPublic | null> {
  const meta = await resolveProviderMeta(provider);
  if (!meta) return null;

  const row = await getSettingsRow(provider);
  if (!row) return null;

  return rowToPublic(
    row,
    {
      label: meta.label,
      type: meta.type,
      source: meta.source,
      pluginVersion: meta.pluginVersion,
      configFields: meta.configFields,
      extraAuthorizeParams: meta.extraAuthorizeParams,
    },
    includeSecrets
  );
}

export type UpsertProviderInput = {
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
  extraConfig?: Record<string, string>;
};

export async function upsertProviderSetting(
  provider: string,
  input: UpsertProviderInput
): Promise<ProviderSettingPublic> {
  const known = await isKnownProvider(provider);
  if (!known) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const existing = await getSettingsRow(provider);
  const defaultEnabled = provider === BUILTIN_PASSWORD_PROVIDER;
  const enabled =
    input.enabled !== undefined ? input.enabled : (existing?.enabled ?? defaultEnabled);
  const clientId = input.clientId ?? existing?.client_id ?? '';
  let clientSecret = existing?.client_secret ?? '';

  if (input.clientSecret !== undefined && input.clientSecret !== '' && input.clientSecret !== '••••••••••••') {
    clientSecret = input.clientSecret;
  }

  const meta = await resolveProviderMeta(provider);
  let extraConfig = {
    ...((existing?.extra_config as Record<string, string>) || {}),
    ...(input.extraConfig || {}),
  };
  if (meta?.type === 'oauth') {
    extraConfig = withDefaultOAuthExtraConfig(provider, 'oauth', extraConfig);
  }

  settingsByProvider.set(provider, {
    provider,
    enabled,
    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
    extra_config: extraConfig,
  });

  await syncRuntimeEnabledProviders();

  const updated = await getProviderSetting(provider, true);
  if (!updated) throw new Error('Failed to save provider settings');
  return updated;
}

export async function assertProviderReady(provider: string): Promise<ProviderSettingPublic> {
  const setting = await getProviderSetting(provider);
  if (!setting || !isProviderReady(setting)) {
    throw new Error(`Provider '${provider}' is not enabled or not configured`);
  }
  return setting;
}

export async function getEnabledProviders(): Promise<string[]> {
  return getReadyProviderIds();
}

export async function setEnabledProviders(providers: string[]): Promise<string[]> {
  const all = await getAllProviderSettings(true);
  const normalized: string[] = [];
  for (const id of providers) {
    const trimmed = id.trim().toLowerCase();
    if (await isKnownProvider(trimmed)) normalized.push(trimmed);
  }

  for (const setting of all) {
    await upsertProviderSetting(setting.provider, {
      enabled: normalized.includes(setting.provider),
      clientId: setting.clientId,
      clientSecret: setting.hasClientSecret ? '••••••••••••' : '',
      extraConfig: setting.extraConfig,
    });
  }

  return getEnabledProviders();
}

export function loadProviderSettingsFromProductBootstrap(
  rows: Array<{
    provider: string;
    enabled: boolean;
    client_id: string;
    client_secret: string;
    extra_config: Record<string, string>;
  }>
): void {
  settingsByProvider.clear();
  rows.forEach((r) => {
    settingsByProvider.set(String(r.provider).toLowerCase(), {
      provider: String(r.provider).toLowerCase(),
      enabled: Boolean(r.enabled),
      client_id: String(r.client_id || ''),
      client_secret: String(r.client_secret || ''),
      extra_config: (r.extra_config as Record<string, string>) || {},
    });
  });
  // Ensure built-in password exists (it can be disabled though)
  void ensurePasswordProviderRow();
}
