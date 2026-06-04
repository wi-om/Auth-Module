import type { PasskeyPluginManifest, ProviderPluginManifest } from './manifestSchema';

export type ResolvedPasskeyConfig = {
  rpID: string;
  rpName: string;
  origin: string;
  origins: string[];
  userVerification: 'required' | 'preferred' | 'discouraged';
  authenticatorAttachment?: 'platform' | 'cross-platform';
  attestationType: 'none' | 'indirect' | 'direct';
  requireResidentKey: boolean;
  allowConditionalMediation: boolean;
};

function parseOriginsList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function hostnameFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

/** RP ID must be a hostname only (e.g. localhost), never a full URL or origin. */
function normalizeRpId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.includes('://')) {
    const host = hostnameFromOrigin(trimmed);
    if (host) return host;
  }
  // Strip accidental path/port if user pasted host:port without scheme
  const withoutPath = trimmed.split('/')[0];
  const hostOnly = withoutPath.split(':')[0];
  return hostOnly || trimmed;
}

export function resolvePasskeyConfig(
  manifest: PasskeyPluginManifest,
  extraConfig: Record<string, string>,
  requestOrigin?: string
): ResolvedPasskeyConfig {
  const passkey = manifest.passkey;
  const envRpId = process.env.WEBAUTHN_RP_ID?.trim();
  const envRpName = process.env.WEBAUTHN_RP_NAME?.trim();
  const envOrigins = parseOriginsList(process.env.WEBAUTHN_ORIGINS);
  const frontendOrigin = (process.env.FRONTEND_APP_URL || 'http://localhost:5900').replace(/\/$/, '');

  const rpIdOverride = normalizeRpId(extraConfig.rpId || '') || normalizeRpId(envRpId || '');
  const rpID =
    rpIdOverride ||
    (requestOrigin ? hostnameFromOrigin(requestOrigin) : null) ||
    hostnameFromOrigin(frontendOrigin) ||
    'localhost';

  const origins = envOrigins.length > 0 ? envOrigins : [frontendOrigin];
  const origin =
    requestOrigin && origins.includes(requestOrigin)
      ? requestOrigin
      : origins[0] || frontendOrigin;

  return {
    rpID,
    rpName: envRpName || passkey.rpName || manifest.label,
    origin,
    origins,
    userVerification: passkey.userVerification || 'preferred',
    authenticatorAttachment: passkey.authenticatorAttachment,
    attestationType: passkey.attestationType || 'none',
    requireResidentKey: passkey.requireResidentKey === true,
    allowConditionalMediation: passkey.allowConditionalMediation !== false,
  };
}

export function assertPasskeyPlugin(manifest: ProviderPluginManifest): PasskeyPluginManifest {
  if (manifest.type !== 'passkey') {
    throw new Error('Provider is not a passkey plugin');
  }
  return manifest;
}
