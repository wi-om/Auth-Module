# Auth Microservice Prototype

Stateless auth service with a **React setup console** (`setup-ui/`). It connects to a **product PostgreSQL database** (no dedicated auth DB) and stores plugin/OAuth settings there.

**Connect this service to another app:** see **[INTEGRATION.md](./INTEGRATION.md)**.

## Quick Start

1. Copy env:

   - `cp .env.example .env` (Linux/macOS)
   - or create `.env` manually on Windows

2. Set `JWT_SECRET`, `OAUTH_CALLBACK_BASE_URL`, and `FRONTEND_APP_URL` in `.env`.

3. Run service:

```bash
npm run dev
```

4. Build and open setup UI: **http://localhost:5600/setup**

   ```bash
   npm run build    # builds API + setup-ui
   npm start        # or npm run dev (API only; build UI first for /setup)
   ```

   - **Connection** tab: product `DATABASE_URL`, `companyId`, pepper, JWT secret, CORS
   - **Providers** tab: enable providers, upload plugins, save credentials
   - **Password flow** tab: documentation

**Develop setup UI with hot reload** (API on `:5600`, UI on `:5174`):

```bash
npm run dev              # terminal 1
npm run dev:setup-ui     # terminal 2 → http://localhost:5174/setup/
```

See [setup-ui/README.md](./setup-ui/README.md).

On boot, the service loads provider/plugin config from the saved product connection (`.runtime/setup.json`).

## Routes

### Public

- `GET /health`
- `GET /auth/providers`
- `POST /auth/login` (password provider must be enabled)
- `GET /auth/oauth/:provider/start`
- `GET /auth/oauth/:provider/callback`

### Internal

- `PUT /internal/auth/settings/providers`

Body:

```json
{
  "providers": ["password", "google", "facebook"]
}
```

## Notes

- Password login can run on this service (`POST /auth/product/login`) when pepper + JWT secret are saved in setup.
- OAuth issues an auth-service token; exchange for a product JWT via `POST /auth/product/oauth/complete` (see INTEGRATION.md).
