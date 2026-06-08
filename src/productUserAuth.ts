import crypto from 'crypto';
import { Pool } from 'pg';
import { config } from './config';
import { resolveProductCompanyId } from './bootstrapDb';
import { loadSetupConfigHydrated, type SetupConfig } from './setupStore';
import { describeDatabaseUrl } from './databaseInfo';
import { logLoginDebug, pepperFingerprint } from './loginDebug';
import {
  compareClientHashedPassword,
  hashClientHashedPassword,
} from './productPassword';

export type ProductUserRow = {
  id: string;
  company_id: string;
  email: string;
  name: string;
  phone: string;
  role: string;
  is_active: boolean;
  password: string;
};

export async function requireSetup(): Promise<SetupConfig> {
  const setup = await loadSetupConfigHydrated();
  if (!setup) {
    throw new Error('Product connection is not configured. Complete /setup wizard first.');
  }
  return setup;
}

export function getUserPepper(): string {
  return config.userPepper;
}

export function getProductJwtSecret(): string {
  return config.jwtSecretForProduct;
}

function poolFor(setup: SetupConfig): Pool {
  return new Pool({ connectionString: setup.databaseUrl });
}

const USER_SELECT = `SELECT id::text AS id, company_id::text AS company_id, email, name, phone, role, is_active, password
  FROM users`;

export async function findProductUserByEmail(
  setup: SetupConfig,
  email: string
): Promise<ProductUserRow | null> {
  const pool = poolFor(setup);
  const companyId = await resolveProductCompanyId(setup.databaseUrl);
  const normalizedEmail = email.trim();
  try {
    const scoped = await pool.query<ProductUserRow>(
      `${USER_SELECT} WHERE LOWER(email) = LOWER($1) AND company_id::text = $2 LIMIT 1`,
      [normalizedEmail, companyId]
    );
    if (scoped.rows[0]) {
      return scoped.rows[0];
    }

    // Stale setup.json can point at a wrong companyId — still allow valid product users.
    const byEmail = await pool.query<ProductUserRow>(
      `${USER_SELECT} WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail]
    );
    const candidate = byEmail.rows[0];
    if (!candidate) {
      return null;
    }

    const org = await pool.query(
      `SELECT 1 FROM organisations WHERE id::text = $1 LIMIT 1`,
      [candidate.company_id]
    );
    return org.rowCount ? candidate : null;
  } finally {
    await pool.end();
  }
}

export async function loginProductUser(
  email: string,
  clientHashedPassword: string
): Promise<ProductUserRow> {
  const setup = await requireSetup();
  const resolvedCompanyId = await resolveProductCompanyId(setup.databaseUrl);
  const user = await findProductUserByEmail(setup, email);

  if (!user) {
    logLoginDebug('failed_user_not_found', {
      email: email.trim().toLowerCase(),
      database: describeDatabaseUrl(setup.databaseUrl).label,
      setupCompanyId: setup.companyId,
      resolvedCompanyId,
      pepper: pepperFingerprint(config.userPepper),
      hint: 'Use backend DATABASE_URL (database erp) and run npm run seed if demo users are missing',
    });
    throw new Error('Invalid credentials');
  }
  if (!user.is_active) {
    logLoginDebug('failed_account_deactivated', {
      email: user.email,
      userId: user.id,
      companyId: user.company_id,
    });
    throw new Error('Account is deactivated');
  }

  const computedHash = hashClientHashedPassword(
    clientHashedPassword,
    user.id,
    config.userPepper
  );
  const valid = compareClientHashedPassword(
    clientHashedPassword,
    user.id,
    user.password,
    config.userPepper
  );
  if (!valid) {
    logLoginDebug('failed_password_mismatch', {
      email: user.email,
      userId: user.id,
      userCompanyId: user.company_id,
      setupCompanyId: setup.companyId,
      resolvedCompanyId,
      pepper: pepperFingerprint(config.userPepper),
      storedHashPrefix: user.password.slice(0, 12),
      computedHashPrefix: computedHash.slice(0, 12),
      hashMatch: computedHash === user.password,
    });
    throw new Error('Invalid credentials');
  }

  logLoginDebug('success', {
    email: user.email,
    userId: user.id,
    companyId: user.company_id,
    resolvedCompanyId,
  });
  return user;
}

export async function createProductUser(input: {
  name: string;
  email: string;
  phone: string;
  role: string;
  clientHashedPassword: string;
}): Promise<ProductUserRow> {
  const setup = await requireSetup();
  const pool = poolFor(setup);
  try {
    const existing = await pool.query(
      `SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [input.email.trim()]
    );
    if (existing.rowCount) {
      throw new Error('Email already exists');
    }

    const userId = crypto.randomUUID();
    const storedHash = hashClientHashedPassword(
      input.clientHashedPassword,
      userId,
      config.userPepper
    );

    const insert = await pool.query<ProductUserRow>(
      `INSERT INTO users (id, company_id, name, email, password, phone, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       RETURNING id, company_id, email, name, phone, role, is_active, password`,
      [
        userId,
        setup.companyId,
        input.name.trim(),
        input.email.trim().toLowerCase(),
        storedHash,
        input.phone,
        input.role,
      ]
    );
    return insert.rows[0];
  } finally {
    await pool.end();
  }
}
