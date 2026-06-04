import crypto from 'crypto';
import { Pool } from 'pg';
import { resolvePluginRedirectUri } from './plugin/oauthRedirectUri';
import type { ProviderPluginManifest } from './plugin/manifestSchema';
import { PRODUCT_SIGN_IN_FLAG } from './productProviderFilter';
import { invalidateAdminProductSeparation } from './adminProductSeparationCache';
import { reloadProductRuntimeFromSetup } from './runtimeSync';
import type { SetupConfig } from './setupStore';

/** Product sign-in only — writes auth_provider_plugins + auth_provider_settings. */
export async function persistPluginManifest(
  config: SetupConfig,
  manifest: ProviderPluginManifest,
  sourceFilename: string
): Promise<void> {
  const checksum = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    await pool.query(
      `INSERT INTO auth_provider_plugins (id, company_id, label, version, plugin_type, manifest, source_filename, source_checksum, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,NOW())
       ON CONFLICT (company_id, id)
       DO UPDATE SET label=EXCLUDED.label, version=EXCLUDED.version, plugin_type=EXCLUDED.plugin_type, manifest=EXCLUDED.manifest, source_filename=EXCLUDED.source_filename, source_checksum=EXCLUDED.source_checksum, updated_at=NOW()`,
      [
        manifest.id,
        config.companyId,
        manifest.label,
        manifest.version,
        manifest.type,
        JSON.stringify(manifest),
        sourceFilename,
        checksum,
      ]
    );
    const productExtra =
      manifest.type === 'oauth'
        ? {
            [PRODUCT_SIGN_IN_FLAG]: 'true',
            redirectUri: resolvePluginRedirectUri(manifest.id),
          }
        : { [PRODUCT_SIGN_IN_FLAG]: 'true' };
    await pool.query(
      `INSERT INTO auth_provider_settings (company_id, provider, enabled, client_id, client_secret, extra_config, updated_at)
       VALUES ($1,$2,FALSE,'','',$3::jsonb,NOW())
       ON CONFLICT (company_id, provider)
       DO UPDATE SET
         extra_config = COALESCE(auth_provider_settings.extra_config, '{}'::jsonb) || EXCLUDED.extra_config,
         updated_at = NOW()`,
      [config.companyId, manifest.id, JSON.stringify(productExtra)]
    );
  } finally {
    await pool.end();
  }
  invalidateAdminProductSeparation(config);
  await reloadProductRuntimeFromSetup();
}

export async function ensurePasswordProvider(config: SetupConfig): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    await pool.query(
      `INSERT INTO auth_provider_settings (company_id, provider, enabled, client_id, client_secret, extra_config)
       VALUES ($1, 'password', TRUE, '', '', '{}'::jsonb)
       ON CONFLICT (company_id, provider) DO NOTHING`,
      [config.companyId]
    );
  } finally {
    await pool.end();
  }
}
