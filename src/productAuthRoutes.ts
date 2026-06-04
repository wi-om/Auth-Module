import { Router } from 'express';
import { config } from './config';
import { getPublicAuthOptions } from './providers';
import { verifyAccessToken } from './tokens';
import { sessionResponseForUser } from './productJwt';
import {
  createProductUser,
  findProductUserByEmail,
  loginProductUser,
  requireSetup,
} from './productUserAuth';
import { loadSetupConfigHydrated } from './setupStore';

export const productAuthRouter = Router();

const CLIENT_HASH_HEX = /^[a-f0-9]{64}$/i;

function isClientHash(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_HASH_HEX.test(value);
}

productAuthRouter.get('/config', async (_req, res, next) => {
  try {
    const setup = await loadSetupConfigHydrated();
    const productAuthReady = Boolean(setup?.databaseUrl && setup?.companyId && config.userPepper && config.jwtSecretForProduct);
    res.json({
      authServiceUrl: config.publicBaseUrl || `http://localhost:${config.port}`,
      productAuthReady,
      companyId: setup?.companyId || null,
      allowedOrigins: config.allowedOrigins,
      endpoints: {
        providers: '/auth/providers',
        login: '/auth/product/login',
        register: '/auth/product/register',
        oauthComplete: '/auth/product/oauth/complete',
      },
    });
  } catch (error) {
    next(error);
  }
});

productAuthRouter.get('/providers', async (_req, res, next) => {
  try {
    const providers = await getPublicAuthOptions();
    res.json({ providers });
  } catch (error) {
    next(error);
  }
});

productAuthRouter.post('/login', async (req, res, next) => {
  try {
    const { email, clientHashedPassword } = req.body || {};
    if (!email || !isClientHash(clientHashedPassword)) {
      return res.status(400).json({
        error: 'email and clientHashedPassword (64-char hex) are required',
      });
    }
    await requireSetup();
    const user = await loginProductUser(String(email), clientHashedPassword);
    res.json(sessionResponseForUser(user));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    const status = message === 'Invalid credentials' || message.includes('deactivated') ? 401 : 400;
    res.status(status).json({ error: message });
  }
});

productAuthRouter.post('/register', async (req, res, next) => {
  try {
    const { name, email, phone, role, clientHashedPassword } = req.body || {};
    if (!name || !email || !phone || !role || !isClientHash(clientHashedPassword)) {
      return res.status(400).json({
        error: 'name, email, phone, role, and clientHashedPassword (64-char hex) are required',
      });
    }
    await requireSetup();
    const user = await createProductUser({
      name: String(name),
      email: String(email),
      phone: String(phone),
      role: String(role),
      clientHashedPassword,
    });
    res.status(201).json(sessionResponseForUser(user));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    const status = message === 'Email already exists' ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

/** Exchange auth-microservice OAuth token for a product JWT (same secret as product backend). */
productAuthRouter.post('/oauth/complete', async (req, res, next) => {
  try {
    const authToken =
      (typeof req.body?.accessToken === 'string' && req.body.accessToken) ||
      (typeof req.headers.authorization === 'string' &&
        req.headers.authorization.startsWith('Bearer ') &&
        req.headers.authorization.slice(7));
    if (!authToken) {
      return res.status(400).json({ error: 'accessToken or Authorization Bearer is required' });
    }
    const claims = verifyAccessToken(authToken);
    const setup = await requireSetup();
    const user = await findProductUserByEmail(setup, claims.email);
    if (!user) {
      return res.status(403).json({
        error: 'No product user for this email. Create the user in your app first.',
      });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }
    res.json(sessionResponseForUser(user));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth completion failed';
    res.status(401).json({ error: message });
  }
});
