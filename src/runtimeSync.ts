import {
  enforceAdminProductStorageSeparation,
  loadAdminProviderContext,
} from './adminOAuthConfig';
import { loadPluginsFromProductBootstrap } from './plugin/pluginRegistry';
import { loadProviderSettingsFromProductBootstrap } from './providerSettings';
import { getBootstrapFromProductDb } from './productDbConfig';
import { shouldHideFromEndUserProviderList } from './productProviderFilter';
import { loadSetupConfigHydrated } from './setupStore';

/** Load only product (end-user) plugins/settings into runtime — never setup-admin OAuth rows. */
export async function reloadProductRuntimeFromSetup(): Promise<boolean> {
  const setup = await loadSetupConfigHydrated();
  if (!setup) return false;

  await enforceAdminProductStorageSeparation(setup);
  const { adminAuthProvider, adminOnlyProviderIds: adminOnly } = await loadAdminProviderContext(setup);
  const payload = await getBootstrapFromProductDb(setup.databaseUrl, setup.companyId);

  const productProviders = (payload.providers || []).filter(
    (p) => !shouldHideFromEndUserProviderList(p.provider, p, adminOnly, adminAuthProvider)
  );
  const productPlugins = (payload.plugins || []).filter(
    (p) => !shouldHideFromEndUserProviderList(p.id, {}, adminOnly, adminAuthProvider)
  );

  loadPluginsFromProductBootstrap(productPlugins as Parameters<typeof loadPluginsFromProductBootstrap>[0]);
  loadProviderSettingsFromProductBootstrap(
    productProviders as Parameters<typeof loadProviderSettingsFromProductBootstrap>[0]
  );
  return true;
}

/** @deprecated Use reloadProductRuntimeFromSetup — same behavior. */
export async function reloadRuntimeFromSetup(): Promise<boolean> {
  return reloadProductRuntimeFromSetup();
}
