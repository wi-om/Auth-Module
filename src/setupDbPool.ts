import { Pool } from 'pg';

const pools = new Map<string, Pool>();

/** Reuse one pool per database URL (avoids repeated Azure SSL handshakes on every setup API call). */
export function getSetupPool(databaseUrl: string): Pool {
  let pool = pools.get(databaseUrl);
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl, max: 5 });
    pools.set(databaseUrl, pool);
  }
  return pool;
}

export async function closeSetupPools(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end().catch(() => undefined)));
  pools.clear();
}
