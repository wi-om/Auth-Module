import { config } from './config';

export function resolveSetupAdminOAuthRedirectUri(providerId: string): string {
  const base = (config.publicBaseUrl || `http://localhost:${config.port}`).replace(/\/$/, '');
  return `${base}/setup/api/admin/oauth/${encodeURIComponent(providerId.toLowerCase())}/callback`;
}

export function getSetupUiBaseUrl(): string {
  return (config.publicBaseUrl || `http://localhost:${config.port}`).replace(/\/$/, '');
}

export function redirectSetupAdminOAuthSuccess(accessToken: string): string {
  return `${getSetupUiBaseUrl()}/setup?admin_oauth=1&accessToken=${encodeURIComponent(accessToken)}`;
}

export function redirectSetupAdminOAuthError(message: string): string {
  return `${getSetupUiBaseUrl()}/setup?admin_oauth_error=${encodeURIComponent(message)}`;
}
