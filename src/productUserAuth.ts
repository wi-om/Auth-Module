import crypto from 'crypto';
import { Pool } from 'pg';
import { config } from './config';
import { resolveProductCompanyId } from './bootstrapDb';
import { loadSetupConfigHydrated, type SetupConfig } from './setupStore';
import { compareClientHashedPassword, hashClientHashedPassword } from './productPassword';

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

export async function findProductUserByEmail(
  setup: SetupConfig,
  email: string
): Promise<ProductUserRow | null> {
  const pool = poolFor(setup);
  const companyId = await resolveProductCompanyId(setup.databaseUrl);
  try {
    const result = await pool.query<ProductUserRow>(
      `SELECT id, company_id::text AS company_id, email, name, phone, role, is_active, password
       FROM users
       WHERE LOWER(email) = LOWER($1) AND company_id::text = $2
       LIMIT 1`,
      [email.trim(), companyId]
    );
    return result.rows[0] || null;
  } finally {
    await pool.end();
  }
}

export async function loginProductUser(
  email: string,
  clientHashedPassword: string
): Promise<ProductUserRow> {
  const setup = await requireSetup();
  const user = await findProductUserByEmail(setup, email);
  if (!user) {
    throw new Error('Invalid credentials');
  }
  if (!user.is_active) {
    throw new Error('Account is deactivated');
  }
  const valid = compareClientHashedPassword(
    clientHashedPassword,
    user.id,
    user.password,
    config.userPepper
  );
  if (!valid) {
    throw new Error('Invalid credentials');
  }
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
