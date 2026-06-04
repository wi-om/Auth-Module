import type { Request, Response, NextFunction } from 'express';
import { config } from './config';

function parseAllowedOrigins(raw?: string[]): string[] {
  if (!raw?.length) return [];
  return raw.map((o) => o.trim()).filter(Boolean);
}

export function corsMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const allowed = parseAllowedOrigins(config.allowedOrigins);
    const origin = req.headers.origin;

    if (origin && (allowed.length === 0 || allowed.includes(origin) || allowed.includes('*'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}
