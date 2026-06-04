/**
 * Default OAuth callback URL for a plugin (from OAUTH_CALLBACK_BASE_URL).
 * Stored in `extra_config.redirectUri` on setup unless overridden.
 */
export function resolvePluginRedirectUri(pluginId: string): string {
  const base = process.env.OAUTH_CALLBACK_BASE_URL || 'http://localhost:5600';
  return `${base.replace(/\/$/, '')}/auth/oauth/${encodeURIComponent(pluginId)}/callback`;
}
