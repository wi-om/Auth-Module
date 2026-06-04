# Auth Setup UI

React + Vite wizard for first-run auth microservice configuration.

## Flow

1. **Database** — product DB or auth-only DB; migration runs automatically
2. **Register admin** — one-time setup operator
3. **Providers** — OAuth plugins and credentials
4. **Finish setup** — then connection screen is hidden
5. **Login** — required on later visits to change settings

## Development

Terminal 1 — auth API:

```bash
cd auth-microservice-prototype
# Set AUTH_ADMIN_PEPPER, AUTH_USER_PEPPER, JWT_SECRET in .env
npm run dev
```

Terminal 2 — setup UI:

```bash
cd auth-microservice-prototype/setup-ui
npm install
npm run dev
```

Open **http://localhost:5174/setup/**

## Production

```bash
cd auth-microservice-prototype
npm run build
npm start
```

Open **http://localhost:5600/setup**
