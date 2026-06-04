# Auth provider plugins

Plugins are **declarative JSON manifests** only. The server never executes uploaded JavaScript.

## Upload formats

| Format | Contents |
|--------|----------|
| `.json` | Full manifest object |
| `.js` / `.ts` | `export default { ... }`, `export default name` (with `const name = { ... }`), or `module.exports = { ... }` |
| `.zip` | Contains `plugin.json`, `manifest.json`, or `provider.json` |

## What admins configure vs what stays in the plugin file

| Admin setup UI (per environment) | Plugin file only (.json / .js / .ts) |
|-----------------------------------|--------------------------------------|
| Client ID | `authorizeUrl`, `tokenUrl`, `userInfoUrl` |
| Client Secret | `scopes`, `tokenClientAuth` |
| Enable / disable | `extraAuthorizeParams` (e.g. UAE PASS `acr_values`, `ui_locales`) |
| — | `profileMapping` |

**Redirect URI is computed by the auth microservice** (not the React admin UI). When a plugin is registered, the server uses manifest `id` and `OAUTH_CALLBACK_BASE_URL`:

`{OAUTH_CALLBACK_BASE_URL}/auth/oauth/{pluginId}/callback`

Example: `http://localhost:5600/auth/oauth/google/callback`. The admin UI only **displays** this value from the API (`redirectUri` on provider settings). Do not put `redirectUri` in `configFields`.

Do **not** put `acr_values`, `ui_locales`, `scope`, or `redirectUri` in `configFields` — upload will reject them. Use `oauth.extraAuthorizeParams` for IdP-specific authorize parameters.

## Manifest schema

```json
{
  "id": "my-org-sso",
  "label": "My Org SSO",
  "version": "1.0.0",
  "type": "oauth",
  "oauth": {
    "authorizeUrl": "https://idp.example.com/oauth/authorize",
    "tokenUrl": "https://idp.example.com/oauth/token",
    "userInfoUrl": "https://idp.example.com/oauth/userinfo",
    "scopes": ["openid", "email"],
    "responseType": "code",
    "tokenClientAuth": "basic",
    "extraAuthorizeParams": {
      "acr_values": "urn:example:auth:level:low",
      "ui_locales": "en"
    }
  },
  "configFields": [
    { "key": "tenantId", "label": "Tenant ID", "required": true }
  ]
}
```

`configFields` is optional. Use it only for provider-specific secrets/IDs (e.g. Entra **Tenant ID**), never for redirect URI.

## JS/TS notes

- Single-quoted strings and unquoted keys are supported (`id: 'github'`).
- Do not put `//` at the start of a line inside the object (use block comments `/* */` for file headers).
- URLs like `https://...` are safe.

## Security

- Plugin IDs must be lowercase slugs (`a-z`, `0-9`, `-`).
- OAuth URLs must use HTTPS (localhost HTTP allowed in development).
- Max upload size: 512 KB.
- Reserved IDs: `password`, `admin`, `internal`, `auth`, `oauth`, etc.

See `examples/google.plugin.json` for a reference OAuth plugin.

## Passkey plugins (`type: "passkey"`)

Passkeys use **WebAuthn** (no OAuth redirect). The auth service stores credentials and issues JWTs after verification.

| Admin setup UI | Plugin file |
|----------------|-------------|
| Enable / disable | `passkey.rpName`, `userVerification`, `authenticatorAttachment`, etc. |
| Optional **rpId** override (hostname) | `configFields` for deployment-specific RP ID |

Environment (auth microservice):

- `WEBAUTHN_RP_ID` — relying party hostname (default: derived from `FRONTEND_APP_URL`)
- `WEBAUTHN_RP_NAME` — display name shown in the passkey prompt
- `WEBAUTHN_ORIGINS` — comma-separated allowed origins (default: `FRONTEND_APP_URL`)

API routes (per plugin id, e.g. `passkey`):

- `POST /auth/{pluginId}/passkey/login/options` — body: `{ email?, origin }`
- `POST /auth/{pluginId}/passkey/login/verify` — body: `{ sessionId, credential, origin }`
- `POST /auth/{pluginId}/passkey/register/options` — body: `{ email, name, origin }`
- `POST /auth/{pluginId}/passkey/register/verify` — body: `{ sessionId, credential, origin }`

A built-in **passkey** plugin is seeded by migration `005_passkey_webauthn.sql`. Enable it in Provider Setup. See `examples/passkey.plugin.json`.

### Local dev checklist

1. **Admin → Provider Setup → Passkey** — turn **Enabled** on, save.
2. **Relying Party ID** — use `localhost` only (not `http://localhost:5900`). Leave empty to auto-detect.
3. Auth service `.env`: `FRONTEND_APP_URL=http://localhost:5900` (origin for verification).
4. Open the app at `http://localhost:5900` (same host as RP ID).
5. **Register a passkey first** (name + email on Register), then **Sign in with Passkey** on Login.
6. Use **http** in dev (not https) unless you configure HTTPS and matching origins.

If you see *"RP ID … is invalid for this domain"*, the RP ID does not match the browser hostname — fix the admin **rpId** field or `WEBAUTHN_RP_ID` to `localhost`.

### Sign in with Apple (`apple.plugin.json`)

- Register a **Services ID** in [Apple Developer](https://developer.apple.com/account/resources/identifiers/list/serviceId).
- **Client secret** is a signed JWT (from your `.p8` key), not a static string — generate it and paste into **Client Secret** in setup.
- Set **Return URL** to the auto-mapped callback shown in Provider Setup (e.g. `http://localhost:5600/auth/oauth/apple/callback`).
- Apple does not expose a userinfo URL; name/email are only sent on the **first** sign-in (callback / `id_token`). Full profile handling may require extending the auth service callback.
