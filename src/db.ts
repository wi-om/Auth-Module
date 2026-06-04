// Auth microservice is stateless in this build (no database).
// Keep this file to avoid large refactors where it used to be imported.

type PoolLike = {
  query: <T = unknown>(_text: string, _params?: unknown[]) => Promise<{ rows: T[]; rowCount: number }>;
  connect: () => Promise<{
    query: PoolLike['query'];
    release: () => void;
  }>;
};

export const pool: PoolLike = {
  async query() {
    throw new Error('Auth service DB is disabled (stateless mode)');
  },
  async connect() {
    return {
      query: pool.query,
      release: () => undefined,
    };
  },
};

export async function runMigrations(): Promise<void> {
  // no-op
}

