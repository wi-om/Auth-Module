import { config } from './config';

export type ProductAuthBootstrap = {
  plugins: Array<{
    id: string;
    label: string;
    version: string;
    plugin_type: 'oauth' | 'passkey';
    manifest: unknown;
    source_filename: string;
    source_checksum: string;
    created_at?: string | Date;
    updated_at?: string | Date;
  }>;
  providers: Array<{
    provider: string;
    enabled: boolean;
    client_id: string;
    client_secret: string;
    extra_config: Record<string, string>;
  }>;
};

export async function fetchProductBootstrap(): Promise<ProductAuthBootstrap | null> {
  if (!config.productApiUrl || !config.productInternalKey || !config.productCompanyId) {
    return null;
  }

  const url = new URL(`${config.productApiUrl}/api/internal/auth-setup/bootstrap`);
  url.searchParams.set('companyId', config.productCompanyId);

  const response = await fetch(url.toString(), {
    headers: {
      'x-internal-api-key': config.productInternalKey,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    const message = parsed?.message || parsed?.error || `Bootstrap failed (${response.status})`;
    throw new Error(message);
  }

  const data = parsed?.data ?? parsed;
  if (!data?.plugins || !data?.providers) {
    throw new Error('Bootstrap payload missing plugins/providers');
  }

  return data as ProductAuthBootstrap;
}

