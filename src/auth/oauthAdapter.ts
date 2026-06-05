import crypto from 'crypto';
import type { OAuthPluginManifest } from '../plugin/manifestSchema';
import { resolvePluginRedirectUri } from '../plugin/oauthRedirectUri';
import type { ProviderSettingPublic } from '../providerSettings';

export type OAuthStartResult = {
  mode: 'prototype' | 'redirect';
  provider: string;
  label: string;
  redirectUrl?: string;
  state?: string;
  accessToken?: string;
  user?: { id: string; email: string; name: string };
};

export function buildRedirectUriForSetting(setting: ProviderSettingPublic): string {
  const manual = setting.extraConfig?.redirectUri?.trim() || setting.redirectUri?.trim();
  if (manual) return manual;
  return resolvePluginRedirectUri(setting.provider);
}

function resolveAuthorizeUrl(manifest: OAuthPluginManifest, setting: ProviderSettingPublic): string {
  let url = manifest.oauth.authorizeUrl;
  const tenantId = setting.extraConfig?.tenantId?.trim();
  if (tenantId && url.includes('/common/')) {
    url = url.replace('/common/', `/${tenantId}/`);
  }
  if (tenantId && url.includes('login.microsoftonline.com/common')) {
    url = url.replace('login.microsoftonline.com/common', `login.microsoftonline.com/${tenantId}`);
  }
  return url;
}

/** Build OAuth2 authorization URL from declarative plugin manifest (no user code execution). */
export function buildOAuthAuthorizeUrl(
  manifest: OAuthPluginManifest,
  setting: ProviderSettingPublic,
  state: string
): string {
  const url = new URL(resolveAuthorizeUrl(manifest, setting));
  url.searchParams.set('client_id', setting.clientId);
  url.searchParams.set('redirect_uri', buildRedirectUriForSetting(setting));
  url.searchParams.set('response_type', manifest.oauth.responseType || 'code');
  url.searchParams.set('scope', manifest.oauth.scopes.join(' '));
  url.searchParams.set('state', state);

  // IdP-specific authorize params (acr_values, ui_locales, etc.) come from the plugin manifest only.
  Object.entries(manifest.oauth.extraAuthorizeParams || {}).forEach(([key, value]) => {
    if (value != null && String(value).trim() !== '') {
      url.searchParams.set(key, String(value).trim());
    }
  });

  return url.toString();
}

export async function exchangeAuthorizationCode(
  manifest: OAuthPluginManifest,
  setting: ProviderSettingPublic,
  clientSecret: string,
  code: string
): Promise<string> {
  const redirectUri = buildRedirectUriForSetting(setting);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const useBasic =
    manifest.oauth.tokenClientAuth === 'basic' || setting.provider === 'uaepass';

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  if (useBasic) {
    const credentials = Buffer.from(`${setting.clientId}:${clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${credentials}`;
  } else {
    body.set('client_id', setting.clientId);
    body.set('client_secret', clientSecret);
  }

  const tokenUrl = resolveTokenUrl(manifest, setting);
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers,
    body: body.toString(),
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error('Invalid token response from identity provider');
  }

  if (!response.ok) {
    const err = typeof data.error === 'string' ? data.error : 'token_exchange_failed';
    const desc = typeof data.error_description === 'string' ? data.error_description : text;
    throw new Error(`${err}: ${desc}`);
  }

  const accessToken = data.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('No access_token in token response');
  }
  return accessToken;
}

function resolveTokenUrl(manifest: OAuthPluginManifest, setting: ProviderSettingPublic): string {
  let url = manifest.oauth.tokenUrl;
  const tenantId = setting.extraConfig?.tenantId?.trim();
  if (tenantId && url.includes('/common/')) {
    url = url.replace('/common/', `/${tenantId}/`);
  }
  return url;
}

function readProfileField(profile: Record<string, unknown>, path?: string): string | undefined {
  if (!path) return undefined;
  if (path in profile && profile[path] != null) {
    return String(profile[path]);
  }
  const parts = path.split('.');
  let current: unknown = profile;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current != null ? String(current) : undefined;
}

export async function fetchOAuthUserProfile(
  manifest: OAuthPluginManifest,
  accessToken: string
): Promise<Record<string, unknown>> {
  if (!manifest.oauth.userInfoUrl) {
    return {};
  }

  const response = await fetch(manifest.oauth.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Userinfo request failed (${response.status})`);
  }

  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export function mapProfileToUser(
  manifest: OAuthPluginManifest,
  provider: string,
  label: string,
  profile: Record<string, unknown>
): { id: string; email: string; name: string } {
  const mapping = manifest.oauth.profileMapping || {};
  const id =
    readProfileField(profile, mapping.id) ||
    readProfileField(profile, 'sub') ||
    readProfileField(profile, 'id') ||
    readProfileField(profile, 'uuid') ||
    `oauth-${provider}-${crypto.randomUUID()}`;
  const email =
    readProfileField(profile, mapping.email) ||
    readProfileField(profile, 'email') ||
    `${provider}@oauth.local`;
  const name =
    readProfileField(profile, mapping.name) ||
    readProfileField(profile, 'name') ||
    readProfileField(profile, 'fullnameEN') ||
    readProfileField(profile, 'displayName') ||
    label;

  return { id, email, name };
}

/** Instant sign-in without IdP — only when OAUTH_PROTOTYPE_MODE=true */
export function createPrototypeOAuthSession(
  provider: string,
  label: string
): OAuthStartResult {
  const subject = `oauth-${provider}-${crypto.randomUUID()}`;
  return {
    mode: 'prototype',
    provider,
    label,
    user: {
      id: subject,
      email: `${provider}@oauth.local`,
      name: label,
    },
  };
}

/** Real OAuth redirect is default; set OAUTH_PROTOTYPE_MODE=true only to skip IdP. */
export function isOAuthPrototypeMode(): boolean {
  return process.env.OAUTH_PROTOTYPE_MODE === 'true';
}

export function getFrontendAppBaseUrl(): string {
  return (process.env.FRONTEND_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function getFrontendOAuthCompleteUrl(): string {
  return `${getFrontendAppBaseUrl()}/oauth/callback`;
}

export function getFrontendOAuthErrorUrl(message: string): string {
  const loginPath = (process.env.FRONTEND_LOGIN_PATH || '/login').replace(/^\//, '');
  return `${getFrontendAppBaseUrl()}/${loginPath}?oauth_error=${encodeURIComponent(message)}`;
}
