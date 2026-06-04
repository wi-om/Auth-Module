import { Pool } from 'pg';
import fs from 'fs';

const setup = JSON.parse(fs.readFileSync('.runtime/setup.json', 'utf8'));
const pool = new Pool({ connectionString: setup.databaseUrl });
const cid = setup.companyId;

try {
  const admins = await pool.query('SELECT email, auth_provider FROM auth_admins LIMIT 5');
  const adminCfg = await pool
    .query(
      'SELECT provider, left(client_id,8) cid, extra_config FROM auth_admin_oauth_config WHERE company_id = $1',
      [cid]
    )
    .catch((e) => ({ rows: [], err: e.message }));
  const adminPlugins = await pool
    .query('SELECT id FROM auth_admin_plugins WHERE company_id = $1', [cid])
    .catch((e) => ({ rows: [], err: e.message }));
  const settings = await pool.query(
    `SELECT provider, left(client_id,8) cid, extra_config, company_id::text
     FROM auth_provider_settings WHERE company_id = $1 OR company_id IS NULL ORDER BY provider`,
    [cid]
  );
  const plugins = await pool.query(
    `SELECT id, company_id::text FROM auth_provider_plugins WHERE company_id = $1 OR company_id IS NULL ORDER BY id`,
    [cid]
  );

  console.log(JSON.stringify({ companyId: cid, admins: admins.rows, adminCfg, adminPlugins, settings: settings.rows, plugins: plugins.rows }, null, 2));
} finally {
  await pool.end();
}
