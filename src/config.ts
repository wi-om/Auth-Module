import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const jwtSecret = process.env.JWT_SECRET || process.env.AUTH_TOKEN_SECRET || '';

function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS || '';
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const frontend = (process.env.FRONTEND_APP_URL || '').trim().replace(/\/$/, '');
  if (frontend && !origins.includes(frontend)) {
    origins.push(frontend);
  }
  return origins;
}

function requirePepper(name: string, value: string | undefined): string {
  const v = value?.trim();
  if (v) return v;
  if (process.env.NODE_ENV === 'test') {
    return `test-${name}-pepper`;
  }
  if (process.env.NODE_ENV !== 'production') {
    return `dev-${name}-pepper-change-in-production`;
  }
  throw new Error(`${name} is required in production`);
}

export const config = {
  port: parseInt(process.env.PORT || '5600', 10),
  publicBaseUrl: (process.env.OAUTH_CALLBACK_BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(
    /\/$/,
    ''
  ),
  tokenSecret: jwtSecret || (process.env.NODE_ENV === 'production' ? '' : crypto.randomBytes(32).toString('hex')),
  tokenTtlSeconds: parseInt(process.env.TOKEN_TTL_SECONDS || '86400', 10),
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  productApiUrl: (process.env.PRODUCT_API_URL || '').replace(/\/$/, ''),
  productInternalKey: process.env.PRODUCT_INTERNAL_API_KEY || '',
  productCompanyId: process.env.PRODUCT_COMPANY_ID || '',
  adminPepper: requirePepper('AUTH_ADMIN_PEPPER', process.env.AUTH_ADMIN_PEPPER),
  setupResumePepper: requirePepper(
    'AUTH_SETUP_RESUME_PEPPER',
    process.env.AUTH_SETUP_RESUME_PEPPER || process.env.AUTH_ADMIN_PEPPER
  ),
  userPepper: requirePepper(
    'AUTH_USER_PEPPER',
    process.env.AUTH_USER_PEPPER || process.env.AUTH_PASSWORD_PEPPER
  ),
  jwtSecretForProduct: jwtSecret || (process.env.NODE_ENV === 'production' ? '' : crypto.randomBytes(32).toString('hex')),
  productJwtExpiresIn: process.env.PRODUCT_JWT_EXPIRES_IN || '7d',
  allowedOrigins: parseAllowedOrigins(),
};

if (process.env.NODE_ENV === 'production' && !jwtSecret) {
  throw new Error('JWT_SECRET (or AUTH_TOKEN_SECRET) is required in production');
}
