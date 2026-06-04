import crypto from 'crypto';
import { config } from './config';

export type TokenPayload = {
  sub: string;
  email: string;
  name: string;
  provider: string;
};

type SignedToken = TokenPayload & {
  iat: number;
  exp: number;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(data: string): string {
  return crypto.createHmac('sha256', config.tokenSecret).update(data).digest('base64url');
}

export function issueAccessToken(payload: TokenPayload): string {
  const now = Math.floor(Date.now() / 1000);
  const body: SignedToken = {
    ...payload,
    iat: now,
    exp: now + config.tokenTtlSeconds,
  };
  const encoded = base64UrlEncode(JSON.stringify(body));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifyAccessToken(token: string): TokenPayload {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid token format');
  }

  const [encoded, signature] = parts;
  const expected = sign(encoded);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid token signature');
  }

  const parsed = JSON.parse(base64UrlDecode(encoded)) as SignedToken;
  if (!parsed.sub || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return {
    sub: parsed.sub,
    email: parsed.email,
    name: parsed.name,
    provider: parsed.provider,
  };
}
