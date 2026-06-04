/** Safe connection fields for setup UI (never includes DB password). */
export type SetupConnectionPreview = {
  dbMode: 'product' | 'auth_only';
  useUrl: boolean;
  databaseUrl: string;
  host: string;
  port: string;
  user: string;
  database: string;
  ssl: boolean;
};

export function redactDatabaseUrl(databaseUrl: string): string {
  return databaseUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
}

export function parseDatabaseUrlForSetupForm(
  databaseUrl: string,
  dbMode: 'product' | 'auth_only'
): SetupConnectionPreview {
  const ssl = /sslmode=require|ssl=true/i.test(databaseUrl);
  try {
    const normalized = databaseUrl.replace(/^postgresql:/i, 'http:');
    const u = new URL(normalized);
    const user = decodeURIComponent(u.username || '');
    const host = u.hostname || 'localhost';
    const port = u.port || '5432';
    const database = decodeURIComponent((u.pathname || '/postgres').replace(/^\//, '') || 'postgres');
    return {
      dbMode,
      useUrl: false,
      databaseUrl: redactDatabaseUrl(databaseUrl),
      host,
      port,
      user,
      database,
      ssl,
    };
  } catch {
    return {
      dbMode,
      useUrl: true,
      databaseUrl: redactDatabaseUrl(databaseUrl),
      host: 'localhost',
      port: '5432',
      user: 'postgres',
      database: 'postgres',
      ssl,
    };
  }
}
