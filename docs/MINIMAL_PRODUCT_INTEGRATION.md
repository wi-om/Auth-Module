# Minimal product integration

Use this when you want **almost no auth code in the product** — configuration and behavior live in the auth microservice.

## What the product still needs

| Layer | Required |
|-------|----------|
| Database | PostgreSQL (product or dedicated); wizard migrates auth tables |
| Backend | JWT middleware with same `JWT_SECRET` as auth service |
| Frontend | Sign-in calling auth service + `SHA256(plainPassword)` before login |
| Auth server env | `AUTH_ADMIN_PEPPER`, `AUTH_USER_PEPPER`, `JWT_SECRET`, `ALLOWED_ORIGINS` |

## One-time: auth microservice bootstrap

1. Set env on auth server (peppers, JWT, CORS).
2. Open `/setup` → connect database (URL or host/credentials).
3. Register **admin** (setup operator only).
4. Configure plugins → **Finish setup**.
5. Later visits: admin **login** only (no connection screen).

## Frontend calls (direct to auth service)

Base URL: `OAUTH_CALLBACK_BASE_URL` (e.g. `http://localhost:5600`)

| Action | Method | Path |
|--------|--------|------|
| Public config | GET | `/auth/product/config` |
| Login providers | GET | `/auth/providers` |
| Password login | POST | `/auth/product/login` |
| Register | POST | `/auth/product/register` |
| OAuth start | GET | `/auth/oauth/{provider}/start` |
| After OAuth callback | POST | `/auth/product/oauth/complete` |

### Password login body

```json
{
  "email": "user@example.com",
  "clientHashedPassword": "<64-char hex SHA256 of plain password>"
}
```

### Response (product-compatible JWT)

```json
{
  "accessToken": "<JWT signed with JWT_SECRET>",
  "user": { "id", "companyId", "email", "name", "role" }
}
```

## Deep dives

- [REGISTER_TO_LOGIN_FLOW.md](./REGISTER_TO_LOGIN_FLOW.md) — end-user register/login
- [AUTH_SERVICE_A_TO_Z.md](./AUTH_SERVICE_A_TO_Z.md) — full service map
- [../INTEGRATION.md](../INTEGRATION.md) — connect another app
