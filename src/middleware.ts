import { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { verifyAccessToken, type TokenPayload } from './tokens';

export type AuthedRequest = Request & { auth?: TokenPayload };

export function requireBearer(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    req.auth = verifyAccessToken(header.slice(7).trim());
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireInternalKey(req: Request, res: Response, next: NextFunction): void {
  if (!config.internalApiKey) {
    res.status(503).json({ error: 'Internal API key not configured' });
    return;
  }
  const key = req.headers['x-internal-api-key'];
  if (key !== config.internalApiKey) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}
