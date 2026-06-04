# Connect Auth Microservice to Another Product

This guide explains how to plug this auth microservice into **any other application** (not only POMS).

The microservice is deployed **per project** on its own server. It connects to a PostgreSQL database (product app DB or auth-only DB) via a **first-run wizard** at `/setup`, then serves OAuth and password APIs.

---

## First-run bootstrap wizard (`/setup`)

For a **code-level map** of every setup screen, API route, middleware condition, and file path, see [docs/AUTH_SETUP_AND_MIDDLEWARE_FLOW.md](docs/AUTH_SETUP_AND_MIDDLEWARE_FLOW.md).

Secrets live in **service environment only** (not in the setup UI):

| Env variable | Purpose |
|--------------|---------|
| `AUTH_ADMIN_PEPPER` | Setup UI admin register/login |
| `AUTH_USER_PEPPER` | End-user password auth (`/auth/product/login`) |
| `JWT_SECRET` | Admin session + product API JWT |
| `ALLOWED_ORIGINS` | CORS for product frontends |

**Wizard steps:**

1. **Database** — connection URL or host/user/password; test runs migration if `auth_settings`, `auth_admins`, `auth_provider_*` are missing; auto-creates a default `companies` row when needed.
2. **Register admin** — email + password (client SHA-256); one-time.
3. **Configure plugins** — OAuth providers, upload manifests.
4. **Finish setup** — locks bootstrap; **connection screen hidden** on later visits.
5. **Admin login** — required to change providers after finish.

API: `GET /setup/bootstrap/status` drives the React UI.

---

## Recommended: minimal product integration

See **[docs/MINIMAL_PRODUCT_INTEGRATION.md](docs/MINIMAL_PRODUCT_INTEGRATION.md)** for the short checklist.

| Feature | Who handles it (minimal mode) |
|--------|-------------------------------|
| Google / Entra / custom OAuth | **Auth microservice** |
| Provider list on sign-in | **Auth microservice** (`GET /auth/providers`) |
| Email + password login | **Auth microservice** (`POST /auth/product/login`) |
| Product API JWT | **Auth microservice** (signed with service `JWT_SECRET`) |
| Plugin credentials | **Connected database** (`auth_provider_*` tables) |

**Product backend** keeps JWT middleware (`JWT_SECRET` same as auth service). **Product frontend** calls the auth service directly (`ALLOWED_ORIGINS` in service env).

Legacy **proxy pattern** (POMS-style) is still documented below if you prefer routing everything through the product API.

---

## What you get after integration (proxy mode — optional)

| Feature | Who handles it |
|--------|----------------|
| Google / Entra / custom OAuth plugins | **Auth microservice** |
| List login providers on sign-in page | **Auth microservice** → product backend proxies |
| Email + password login | **Auth microservice** *or* product backend |
| User sessions / JWT for the product | **Auth microservice** (minimal) *or* product backend |
| Plugin credentials storage | **Product database** (`auth_provider_*` tables) |

---

## Architecture

```text
┌─────────────────────┐         ┌──────────────────────────┐
│  Other app frontend │ ──────► │  Other app backend API   │
│  (sign-in, OAuth)   │         │  users, JWT, /auth/*     │
└─────────────────────┘         └────────────┬─────────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
                    ▼                        ▼                        ▼
         ┌──────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
         │ Product Postgres │    │ Auth microservice   │    │ IdP (Google,    │
         │ users            │    │ :5600               │    │ Entra, etc.)    │
         │ auth_provider_*  │◄───│ /setup, /auth/*     │───►│                 │
         └──────────────────┘    └─────────────────────┘    └─────────────────┘
```

1. Operator sets peppers + `JWT_SECRET` on the auth server, opens `/setup`, connects DB (migration auto-runs).
2. Operator registers admin, configures plugins, finishes setup.
3. End users use the product app; auth service handles OAuth/password as configured.

---

## Part A — Prepare the other product’s database

### Required tables

On **Test connection** / **Save**, the service runs `scripts/migrations/001-auth-bootstrap.sql` and provider migrations when tables are missing.

Created automatically:

- `auth_settings`, `auth_admins` — bootstrap state and setup operators
- `companies` — default row if none exists (single-tenant)
- `auth_provider_plugins`, `auth_provider_settings` — plugins (see also `poms-backend/scripts/migrations/002-auth-setup.sql`)

**Product DB mode:** existing `users` table is used for end-user login; if missing, a warning is shown until the app creates it.

### Password login (optional but typical)

If the product uses email/password:

- **`users`** table with `email`, `password` (final hash), etc.
- Product backend implements client-hash + pepper flow (see `poms-backend/PASSWORD_HASH_FLOW_DOCUMENTATION.md` in this monorepo).

The auth microservice does **not** store product users for password login in the current stateless build.

---

## Part B — Run and connect the auth microservice

### 1. Start the service

```bash
cd auth-microservice-prototype
cp .env.example .env
# Edit JWT_SECRET, OAUTH_CALLBACK_BASE_URL, FRONTEND_APP_URL
npm install
npm run dev
```

Default URL: `http://localhost:5600`

### 2. Open setup UI

Browser: **`http://localhost:5600/setup`**

### Step 1 — Product connection

| Field | Description |
|-------|-------------|
| **Product DATABASE_URL** | PostgreSQL connection string for the **other app’s** database |
| **Company ID** | UUID of the company/tenant in `companies` table |
| **Product API key** | Optional (reserved for future product API calls) |
| **Password pepper** | Same as product `AUTH_PASSWORD_PEPPER` (enables password login on the service) |
| **Product JWT secret** | Same as product `JWT_SECRET` (service issues tokens your API already accepts) |
| **Allowed frontend origins** | Comma-separated CORS origins for direct browser → auth service calls |

Click **Test connection**, then **Save & Continue**.

This saves config locally to:

`auth-microservice-prototype/.runtime/setup.json`

On every service start, the microservice reloads plugins and provider settings from that product DB.

### Step 2 — Auth providers / plugins

On the same `/setup` page:

1. **Refresh providers** — load current config from product DB.
2. For each provider: enable/disable, set Client ID, Client Secret, Tenant ID (if needed).
3. **Redirect URI** is filled automatically for OAuth plugins (read-only). Register that URI in Google/Entra console.
4. **Upload plugin** — `.json` manifest (see `plugins/examples/entra.plugin.json`).
5. **Save changes** per provider — writes to product DB and reloads runtime immediately.

You do **not** need the product’s admin UI for auth setup if you use this microservice setup page only.

---

## Part C — Configure auth microservice environment

In `auth-microservice-prototype/.env`:

```env
PORT=5600

# Required in production
JWT_SECRET=long-random-secret

# Where OAuth callbacks hit THIS service
OAUTH_CALLBACK_BASE_URL=http://localhost:5600

# Where users land after OAuth (OTHER app sign-in / oauth callback page)
FRONTEND_APP_URL=http://localhost:3000

# Dev only: skip real IdP and fake OAuth login
# OAUTH_PROTOTYPE_MODE=false
```

| Variable | Purpose |
|----------|---------|
| `OAUTH_CALLBACK_BASE_URL` | Base URL of auth microservice (used to build `.../auth/oauth/{provider}/callback`) |
| `FRONTEND_APP_URL` | Other product’s frontend; user is redirected here with `accessToken` after OAuth |

---

## Part D — Integrate the other product’s backend

### Option 1 — Minimal (recommended)

Product backend `.env`:

```env
JWT_SECRET=long-random-secret   # must match /setup “Product JWT secret”
# No AUTH_SERVICE_URL required if frontend calls auth service directly
```

Product frontend uses `GET /auth/product/config` and `POST /auth/product/login` on the auth service. Existing `authenticate` middleware on product routes is unchanged.

### Option 2 — Proxy through product API

Set in the **product** backend `.env`:

```env
AUTH_SERVICE_URL=http://localhost:5600
# Optional if you call internal bootstrap endpoints:
# AUTH_SERVICE_INTERNAL_KEY=shared-secret
# AUTH_SETUP_INTERNAL_KEY=shared-secret

# Only needed if product backend still hashes passwords locally:
AUTH_PASSWORD_PEPPER=long-random-pepper
```

### Minimum API routes to implement (proxy pattern)

Copy the idea from POMS (`poms-backend`):

| Product route | Calls auth microservice |
|---------------|-------------------------|
| `GET /api/auth/providers` | `GET {AUTH_SERVICE_URL}/auth/providers` |
| `GET /api/auth/oauth/:provider/start` | `GET {AUTH_SERVICE_URL}/auth/oauth/:provider/start` |
| `POST /api/auth/oauth/complete` | Verify token from `GET {AUTH_SERVICE_URL}/auth/me` with `Authorization: Bearer`, then issue **product** JWT if user exists in product `users` |

Password routes stay on the **product** backend:

| Product route | Handled by |
|---------------|------------|
| `POST /api/auth/login` | Product DB + `clientHashedPassword` + pepper |
| `POST /api/auth/register` | Product DB (if you allow public signup) |
| `POST /api/users` (admin create user) | Product DB + same hash rules |

Reference files in this repo:

- `poms-backend/src/services/authMicroserviceClient.ts`
- `poms-backend/src/controllers/auth.controller.ts` (OAuth + providers)
- `poms-backend/src/config/authService.ts`

---

## Part E — Integrate the other product’s frontend

### Sign-in page (minimal — call auth service)

Base URL: `OAUTH_CALLBACK_BASE_URL` (e.g. `http://localhost:5600`)

1. `GET {authService}/auth/providers` — show OAuth + password options.
2. Password: `POST {authService}/auth/product/login` with `clientHashedPassword`.
3. OAuth: `GET {authService}/auth/oauth/{provider}/start` → redirect.
4. Callback: `POST {authService}/auth/product/oauth/complete` with OAuth `accessToken` → store returned **product** JWT.

### Sign-in page (proxy — via product API)

1. Load providers from **product** API: `GET /api/auth/providers`.
2. Show buttons for OAuth providers; email/password form if `password` provider is enabled.
3. OAuth: call product `GET /api/auth/oauth/{provider}/start` → redirect to `redirectUrl`.
4. OAuth callback page (e.g. `/oauth/callback`): read `accessToken` from query → `POST /api/auth/oauth/complete` → store product JWT.

Reference: `poms-frontend/src/components/auth/SignInForm.tsx`, `OAuthCallbackHandler.tsx`, `authApi.ts`.

### Password fields

Before login/register API calls, hash in the browser:

```text
clientHashedPassword = SHA256(plainPassword)
```

Send `clientHashedPassword` (64-char hex), **not** plain password.

Reference: `poms-frontend/src/utils/sha256.ts`

---

## Part F — OAuth redirect checklist

For each OAuth provider (e.g. `google`, `entra`):

1. In `/setup`, copy the **Redirect URI** shown for that provider.
2. In Google Cloud / Entra / etc., add that exact URI as an authorized redirect.
3. Ensure `OAUTH_CALLBACK_BASE_URL` matches how the auth service is reachable from the browser (localhost vs public URL).
4. Ensure `FRONTEND_APP_URL` is the other app’s URL where `/oauth/callback` (or equivalent) lives.

Typical redirect URI format:

```text
{OAUTH_CALLBACK_BASE_URL}/auth/oauth/{providerId}/callback
```

Example: `http://localhost:5600/auth/oauth/google/callback`

---

## Multi-tenant / multiple companies

Setup currently stores **one** product connection per microservice instance:

- One `DATABASE_URL`
- One `companyId`

For multiple tenants you can either:

- Run **one auth microservice instance per tenant** (different `.runtime/setup.json`), or
- Extend the product to pass `companyId` on every auth call (future enhancement).

---

## Quick integration checklist

**Minimal path**

- [ ] Product DB has `companies`, `users`, and migration `002-auth-setup.sql` applied
- [ ] Auth microservice running (`npm run dev`)
- [ ] `/setup` Step 1: DB, company, **pepper**, **JWT secret**, **CORS origins**
- [ ] `/setup` Step 2: providers + IdP redirect URIs
- [ ] `OAUTH_CALLBACK_BASE_URL` and `FRONTEND_APP_URL` set correctly
- [ ] Product frontend: calls auth service for login/OAuth; SHA-256 password in browser
- [ ] Product backend: existing JWT middleware only (`JWT_SECRET` matches setup)
- [ ] OAuth users exist in `users` before first OAuth login (same email)

**Proxy path (optional)**

- [ ] Product backend: `AUTH_SERVICE_URL` + proxy routes
- [ ] Product backend: `AUTH_PASSWORD_PEPPER` if password handled locally

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| Providers empty after save | Refresh providers on `/setup`; confirm `companyId` exists in `companies` |
| `company_id` column missing | Run `002-auth-setup.sql` on product DB; restart microservice and re-save connection |
| OAuth works but product login fails | User must exist in product `users` with same email (see POMS `completeOAuthLogin`) |
| Redirect URI mismatch | Copy URI from `/setup`; must match IdP app registration exactly |
| Password login fails | Pepper in `/setup` must match product; use `POST /auth/product/login` with 64-char client hash |
| CORS blocked from browser | Add product frontend URL to **Allowed frontend origins** in `/setup` |
| Old plugins still show on product UI | Restart auth microservice after changes; product UI may cache—reload providers from DB |

---

## Reference implementation in this repo

| Piece | Location |
|-------|----------|
| Auth microservice setup UI | `auth-microservice-prototype/src/setupRoutes.ts` |
| Product DB bootstrap | `auth-microservice-prototype/src/productDbConfig.ts` |
| POMS backend proxy | `poms-backend/src/controllers/auth.controller.ts` |
| POMS frontend sign-in | `poms-frontend/src/components/auth/SignInForm.tsx` |
| Password hash flow doc | `poms-backend/PASSWORD_HASH_FLOW_DOCUMENTATION.md` |
| Auth DB migration | `poms-backend/scripts/migrations/002-auth-setup.sql` |

---

## Summary

1. **Microservice `/setup`** → product DB, pepper, JWT secret, CORS, plugins.
2. **Minimal product** → frontend → auth service for login/OAuth; backend keeps JWT middleware only.
3. **Proxy product (optional)** → `AUTH_SERVICE_URL` + thin routes like POMS.

See [docs/MINIMAL_PRODUCT_INTEGRATION.md](docs/MINIMAL_PRODUCT_INTEGRATION.md).

**Detailed flow documentation:**

| Document | Contents |
|----------|----------|
| [docs/REGISTER_TO_LOGIN_FLOW.md](docs/REGISTER_TO_LOGIN_FLOW.md) | Register → login → product JWT → API; sequence diagrams; file/line index |
| [docs/AUTH_SERVICE_A_TO_Z.md](docs/AUTH_SERVICE_A_TO_Z.md) | Plugins, `/setup`, OAuth, password, tokens, all routes; complete code map |
