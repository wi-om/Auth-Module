import type { Request, Response, NextFunction } from 'express';
import {
  getSetupResumeStatus,
  verifySetupResumeSessionToken,
} from './setupResumeAuth';

export function extractSetupBearer(req: Request): string | null {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

/** Gate setup APIs until resume password is verified (until admin account exists). */
export async function requireSetupResumeAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { resumeRequired } = await getSetupResumeStatus();
  if (!resumeRequired) {
    next();
    return;
  }

  const token = extractSetupBearer(req);
  if (token && verifySetupResumeSessionToken(token)) {
    next();
    return;
  }

  res.status(401).json({
    error: 'Temporary setup password required',
    code: 'SETUP_RESUME_REQUIRED',
  });
}
