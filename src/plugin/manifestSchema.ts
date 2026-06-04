export type PluginConfigField = {

  key: string;

  label: string;

  required?: boolean;

  secret?: boolean;

  placeholder?: string;

};



export type OAuthManifest = {

  authorizeUrl: string;

  tokenUrl: string;

  userInfoUrl?: string;

  scopes: string[];

  responseType?: 'code';

  /** How client credentials are sent to the token endpoint (UAE PASS uses basic). */

  tokenClientAuth?: 'body' | 'basic';

  /** Extra query params on the authorize URL (e.g. UAE PASS acr_values, ui_locales). */

  extraAuthorizeParams?: Record<string, string>;

  profileMapping?: {

    id?: string;

    email?: string;

    name?: string;

  };

};



export type PasskeyManifestOptions = {

  rpName: string;

  userVerification?: 'required' | 'preferred' | 'discouraged';

  authenticatorAttachment?: 'platform' | 'cross-platform';

  attestationType?: 'none' | 'indirect' | 'direct';

  requireResidentKey?: boolean;

  allowConditionalMediation?: boolean;

};



export type OAuthPluginManifest = {

  id: string;

  label: string;

  version: string;

  type: 'oauth';

  oauth: OAuthManifest;

  configFields?: PluginConfigField[];

};



export type PasskeyPluginManifest = {

  id: string;

  label: string;

  version: string;

  type: 'passkey';

  passkey: PasskeyManifestOptions;

  configFields?: PluginConfigField[];

};



export type ProviderPluginManifest = OAuthPluginManifest | PasskeyPluginManifest;



const RESERVED_IDS = new Set(['password', 'admin', 'internal', 'plugin', 'api', 'auth', 'oauth']);



const ID_PATTERN = /^[a-z][a-z0-9-]{2,48}$/;



function isHttpsUrl(value: string, allowLocalhost: boolean): boolean {

  let parsed: URL;

  try {

    parsed = new URL(value);

  } catch {

    return false;

  }

  if (parsed.protocol !== 'https:') {

    if (allowLocalhost && parsed.protocol === 'http:' && parsed.hostname === 'localhost') {

      return true;

    }

    return false;

  }

  return true;

}



/** Admin UI may only collect deployment secrets/URLs — not IdP protocol params. */

const MANIFEST_ONLY_PARAM_KEYS = new Set([

  'acrvalues',

  'acr_values',

  'uilocales',

  'ui_locales',

  'scope',

  'scopes',

  'authorizeurl',

  'tokenurl',

  'userinfourl',

  'responsetype',

  'redirecturi',

  'redirect_uri',

]);



function assertConfigFields(raw: unknown, pluginType: 'oauth' | 'passkey'): PluginConfigField[] | undefined {

  if (raw === undefined) return undefined;

  if (!Array.isArray(raw)) throw new Error('configFields must be an array');

  return raw.map((item, index) => {

    if (!item || typeof item !== 'object') {

      throw new Error(`configFields[${index}] must be an object`);

    }

    const row = item as Record<string, unknown>;

    const key = String(row.key || '').trim();

    if (!/^[a-zA-Z][a-zA-Z0-9_]{1,48}$/.test(key)) {

      throw new Error(`configFields[${index}].key is invalid`);

    }

    const normalizedKey = key.toLowerCase().replace(/-/g, '_');

    if (pluginType === 'oauth' && (normalizedKey === 'redirecturi' || normalizedKey === 'redirect_uri')) {

      throw new Error(

        'Remove redirectUri from configFields — the callback URL is auto-mapped as {OAUTH_CALLBACK_BASE_URL}/auth/oauth/{pluginId}/callback'

      );

    }

    if (pluginType === 'oauth' && MANIFEST_ONLY_PARAM_KEYS.has(normalizedKey)) {

      throw new Error(

        `configFields "${key}" must be set in oauth.extraAuthorizeParams in the plugin file, not in the admin UI`

      );

    }

    const label = String(row.label || '').trim();

    if (!label) throw new Error(`configFields[${index}].label is required`);

    return {

      key,

      label,

      required: row.required === true,

      secret: row.secret === true,

      placeholder: row.placeholder ? String(row.placeholder) : undefined,

    };

  });

}



function assertCommonFields(input: Record<string, unknown>): { id: string; label: string; version: string; type: string } {

  const id = String(input.id || '')

    .trim()

    .toLowerCase();

  const label = String(input.label || '').trim();

  const version = String(input.version || '').trim();

  const type = String(input.type || 'oauth').trim().toLowerCase();



  if (!ID_PATTERN.test(id)) {

    throw new Error('Plugin id must be 3–49 chars: lowercase letters, numbers, hyphens; start with a letter');

  }

  if (RESERVED_IDS.has(id)) {

    throw new Error(`Plugin id "${id}" is reserved`);

  }

  if (!label || label.length > 128) {

    throw new Error('Plugin label is required (max 128 characters)');

  }

  if (!version || version.length > 32) {

    throw new Error('Plugin version is required (max 32 characters)');

  }



  return { id, label, version, type };

}



function validateOAuthManifest(

  input: Record<string, unknown>,

  options: { allowLocalhostUrls?: boolean }

): OAuthPluginManifest {

  const { id, label, version } = assertCommonFields(input);

  const oauthRaw = input.oauth;

  if (!oauthRaw || typeof oauthRaw !== 'object') {

    throw new Error('oauth configuration is required');

  }

  const oauthInput = oauthRaw as Record<string, unknown>;

  const authorizeUrl = String(oauthInput.authorizeUrl || '').trim();

  const tokenUrl = String(oauthInput.tokenUrl || '').trim();

  const userInfoUrl = oauthInput.userInfoUrl ? String(oauthInput.userInfoUrl).trim() : undefined;

  const allowLocal = options.allowLocalhostUrls ?? process.env.NODE_ENV !== 'production';



  if (!isHttpsUrl(authorizeUrl, allowLocal)) {

    throw new Error('oauth.authorizeUrl must be a valid HTTPS URL');

  }

  if (!isHttpsUrl(tokenUrl, allowLocal)) {

    throw new Error('oauth.tokenUrl must be a valid HTTPS URL');

  }

  if (userInfoUrl && !isHttpsUrl(userInfoUrl, allowLocal)) {

    throw new Error('oauth.userInfoUrl must be a valid HTTPS URL');

  }



  const scopesRaw = oauthInput.scopes;

  if (!Array.isArray(scopesRaw) || scopesRaw.length === 0) {

    throw new Error('oauth.scopes must be a non-empty array of strings');

  }

  const scopes = scopesRaw.map((s) => String(s).trim()).filter(Boolean);

  if (scopes.length === 0) {

    throw new Error('oauth.scopes must contain at least one scope');

  }



  const profileMapping =

    oauthInput.profileMapping && typeof oauthInput.profileMapping === 'object'

      ? (oauthInput.profileMapping as OAuthManifest['profileMapping'])

      : undefined;



  const tokenClientAuthRaw = oauthInput.tokenClientAuth;

  const tokenClientAuth =

    tokenClientAuthRaw === 'basic' || tokenClientAuthRaw === 'body' ? tokenClientAuthRaw : undefined;



  const extraAuthorizeParams = assertExtraAuthorizeParams(oauthInput.extraAuthorizeParams);

  const configFields = assertConfigFields(input.configFields, 'oauth');



  return {

    id,

    label,

    version,

    type: 'oauth',

    oauth: {

      authorizeUrl,

      tokenUrl,

      userInfoUrl,

      scopes,

      responseType: 'code',

      ...(tokenClientAuth ? { tokenClientAuth } : {}),

      ...(extraAuthorizeParams ? { extraAuthorizeParams } : {}),

      profileMapping,

    },

    configFields,

  };

}



function validatePasskeyManifest(input: Record<string, unknown>): PasskeyPluginManifest {

  const { id, label, version } = assertCommonFields(input);

  const passkeyRaw = input.passkey;

  if (!passkeyRaw || typeof passkeyRaw !== 'object') {

    throw new Error('passkey configuration is required');

  }

  const passkeyInput = passkeyRaw as Record<string, unknown>;

  const rpName = String(passkeyInput.rpName || '').trim();

  if (!rpName) {

    throw new Error('passkey.rpName is required');

  }



  const userVerificationRaw = passkeyInput.userVerification;

  const userVerification =

    userVerificationRaw === 'required' ||

    userVerificationRaw === 'preferred' ||

    userVerificationRaw === 'discouraged'

      ? userVerificationRaw

      : undefined;



  const attachmentRaw = passkeyInput.authenticatorAttachment;

  const authenticatorAttachment =

    attachmentRaw === 'platform' || attachmentRaw === 'cross-platform' ? attachmentRaw : undefined;



  const attestationRaw = passkeyInput.attestationType;

  const attestationType =

    attestationRaw === 'none' || attestationRaw === 'indirect' || attestationRaw === 'direct'

      ? attestationRaw

      : 'none';



  const configFields = assertConfigFields(input.configFields, 'passkey');



  return {

    id,

    label,

    version,

    type: 'passkey',

    passkey: {

      rpName,

      ...(userVerification ? { userVerification } : {}),

      ...(authenticatorAttachment ? { authenticatorAttachment } : {}),

      attestationType,

      requireResidentKey: passkeyInput.requireResidentKey === true,

      allowConditionalMediation: passkeyInput.allowConditionalMediation !== false,

    },

    configFields,

  };

}



export function validatePluginManifest(

  raw: unknown,

  options: { allowLocalhostUrls?: boolean } = {}

): ProviderPluginManifest {

  if (!raw || typeof raw !== 'object') {

    throw new Error('Plugin manifest must be a JSON object');

  }



  const input = raw as Record<string, unknown>;

  const type = String(input.type || 'oauth').trim().toLowerCase();



  if (type === 'passkey') {

    return validatePasskeyManifest(input);

  }

  if (type !== 'oauth') {

    throw new Error('Plugin type must be "oauth" or "passkey"');

  }



  return validateOAuthManifest(input, options);

}



function assertExtraAuthorizeParams(raw: unknown): Record<string, string> | undefined {

  if (raw === undefined) return undefined;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {

    throw new Error('oauth.extraAuthorizeParams must be an object of string values');

  }

  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {

    const paramKey = key.trim();

    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(paramKey)) {

      throw new Error(`oauth.extraAuthorizeParams key "${key}" is invalid`);

    }

    if (value == null) continue;

    const paramValue = String(value).trim();

    if (!paramValue) continue;

    out[paramKey] = paramValue;

  }

  return Object.keys(out).length > 0 ? out : undefined;

}

