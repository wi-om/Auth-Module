import type { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { verifyProductSessionToken, type ProductSessionPayload } from './productJwt';
import { loadSetupConfigHydrated } from './setupStore';

export type SetupAdminRequest = Request & { setupAdmin?: ProductSessionPayload };

export async function requireSetupAdmin(
  req: SetupAdminRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const setup = await loadSetupConfigHydrated();
  if (!setup) {
    res.status(503).json({ error: 'Setup is not configured' });
    return;
  }

  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Admin login required' });
    return;
  }

  try {
    const token = header.slice(7).trim();
    const claims = verifyProductSessionToken(token, config.jwtSecretForProduct);
    if (claims.role !== 'auth_admin') {
      res.status(403).json({ error: 'Admin access only' });
      return;
    }
    req.setupAdmin = claims;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired admin session' });
  }
}

/** Allow access during bootstrap setup phase without login; require admin after complete. */
export async function requireSetupAdminIfComplete(
  req: SetupAdminRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const setup = await loadSetupConfigHydrated();
  if (!setup) {
    res.status(503).json({ error: 'Setup is not configured' });
    return;
  }
  if (setup.bootstrapPhase !== 'complete') {
    next();
    return;
  }
  return requireSetupAdmin(req, res, next);
}
