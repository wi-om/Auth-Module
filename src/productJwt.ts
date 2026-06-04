import crypto from 'crypto';
import { config } from './config';

/** Matches typical product backends (e.g. POMS `JWTPayload`). */
export type ProductSessionPayload = {
  userId: string;
  companyId: string;
  email: string;
  role: string;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function issueProductSessionToken(
  payload: ProductSessionPayload,
  secret: string,
  expiresInSeconds = 7 * 24 * 60 * 60
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const encoded = base64UrlEncode(JSON.stringify(body));
  const data = `${header}.${encoded}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export function verifyProductSessionToken(token: string, secret: string): ProductSessionPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }
  const [header, encoded, signature] = parts;
  const data = `${header}.${encoded}`;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid token signature');
  }
  const parsed = JSON.parse(base64UrlDecode(encoded)) as ProductSessionPayload & {
    exp?: number;
  };
  if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  if (!parsed.userId || !parsed.companyId || !parsed.email || !parsed.role) {
    throw new Error('Invalid token claims');
  }
  return {
    userId: parsed.userId,
    companyId: parsed.companyId,
    email: parsed.email,
    role: parsed.role,
  };
}

export function sessionResponseForUser(
  user: { id: string; company_id: string; email: string; name: string; role: string }
): { accessToken: string; user: Record<string, unknown> } {
  const expiresIn = parseProductJwtTtl(config.productJwtExpiresIn);
  const accessToken = issueProductSessionToken(
    {
      userId: user.id,
      companyId: user.company_id,
      email: user.email,
      role: user.role,
    },
    config.jwtSecretForProduct,
    expiresIn
  );
  return {
    accessToken,
    user: {
      id: user.id,
      companyId: user.company_id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  };
}

function parseProductJwtTtl(value?: string): number {
  const raw = (value || '7d').trim();
  const match = /^(\d+)([smhd])$/i.exec(raw);
  if (!match) return 7 * 24 * 60 * 60;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 's') return n;
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 60 * 60;
  return n * 24 * 60 * 60;
}
