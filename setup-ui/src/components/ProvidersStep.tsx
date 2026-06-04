import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Loader2, Plus, RefreshCw } from 'lucide-react';
import { completeBootstrap, fetchProviders } from '../api/setupApi';
import type { PluginRow, ProviderRow } from '../types';
import { isAdminOnlyProductProvider } from '../types';
import { toastFromError, toastSuccess } from '../utils/toast';
import { Button, Card } from './ui';
import { AddPluginDialog } from './AddPluginDialog';
import { ProviderDetailPanel } from './ProviderDetailPanel';
import { ProviderIcon } from './ProviderIcon';

type Props = {
  setupComplete: boolean;
  onComplete: () => void;
};

function labelFor(id: string, plugin?: PluginRow): string {
  if (id === 'password') return 'Email & Password';
  return plugin?.label || id;
}

function sublabel(id: string, plugin?: PluginRow): string {
  if (id === 'password') return 'Password';
  const type = plugin?.plugin_type || 'oauth';
  const ver = plugin?.version ? ` · v${plugin.version}` : '';
  return `${type.charAt(0).toUpperCase() + type.slice(1)}${ver}`;
}

function isConfigured(p: ProviderRow, plugin?: PluginRow): boolean {
  if (p.provider === 'password') return p.enabled;
  if (plugin?.plugin_type === 'passkey') return true;
  return Boolean((p.client_id || '').trim()) && p.enabled;
}

function sortProviders(list: ProviderRow[]): ProviderRow[] {
  return [...list].sort((a, b) => {
    if (a.provider === 'password') return -1;
    if (b.provider === 'password') return 1;
    return labelFor(a.provider).localeCompare(labelFor(b.provider));
  });
}

export function ProvidersStep({ setupComplete, onComplete }: Props) {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [plugins, setPlugins] = useState<PluginRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [adminAuthProvider, setAdminAuthProvider] = useState<string | null>(null);
  const [adminOnlyProviderIds, setAdminOnlyProviderIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchProviders();
      const adminAuth = data.adminAuthProvider ?? null;
      const adminOnlyIds = data.adminOnlyProviderIds ?? [];
      const visible = (data.providers || []).filter(
        (p) => !isAdminOnlyProductProvider(p.provider, p, adminAuth, adminOnlyIds)
      );
      const sorted = sortProviders(visible);
      const visibleProviderIds = new Set(sorted.map((p) => p.provider.toLowerCase()));
      const visiblePlugins = (data.plugins || []).filter((p) =>
        visibleProviderIds.has(p.id.toLowerCase())
      );
      setProviders(sorted);
      setPlugins(visiblePlugins);
      setAdminAuthProvider(adminAuth);
      setAdminOnlyProviderIds(adminOnlyIds);
      setSelectedId((prev) => {
        if (prev && sorted.some((p) => p.provider === prev)) return prev;
        return sorted[0]?.provider ?? null;
      });
    } catch (e) {
      toastFromError(e, 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const finishSetup = async () => {
    setFinishing(true);
    try {
      const r = await completeBootstrap();
      toastSuccess(r.message);
      onComplete();
    } catch (e) {
      toastFromError(e, 'Could not finish setup');
    } finally {
      setFinishing(false);
    }
  };

  const pluginById = Object.fromEntries(plugins.map((p) => [p.id.toLowerCase(), p]));
  const selected = providers.find((p) => p.provider === selectedId);
  const selectedPlugin = selectedId ? pluginById[selectedId.toLowerCase()] : undefined;

  return (
    <>
      <Card
        title="Auth providers"
        description="Configure how end users sign in to your product. Setup admin sign-in (step 2) is stored separately and does not appear here until you add a plugin."
        className="!p-0 overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
            {!setupComplete ? (
              <Button type="button" onClick={finishSetup} disabled={finishing}>
                {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Finish setup
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-[480px] flex-col md:flex-row">
          <aside className="w-full shrink-0 border-b border-slate-200 bg-slate-50/80 md:w-72 md:border-b-0 md:border-r">
            <div className="px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Providers</p>
              <p className="text-sm text-slate-600">{providers.length} configured</p>
            </div>

            {loading && providers.length === 0 ? (
              <div className="flex justify-center py-10 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <ul className="px-2 pb-2">
                {providers.map((p) => {
                  const id = p.provider;
                  const plugin = pluginById[id.toLowerCase()];
                  const active = selectedId === id;
                  const ok = isConfigured(p, plugin);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(id)}
                        className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                          active
                            ? 'bg-indigo-100 text-indigo-900 ring-1 ring-indigo-200'
                            : 'text-slate-800 hover:bg-white'
                        }`}
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white">
                          <ProviderIcon
                            providerId={id}
                            type={id === 'password' ? 'password' : plugin?.plugin_type}
                            className="h-5 w-5"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{labelFor(id, plugin)}</p>
                          <p className="truncate text-xs text-slate-500">{sublabel(id, plugin)}</p>
                        </div>
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-300'}`}
                          title={ok ? 'Configured' : 'Needs setup'}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="border-t border-slate-200 p-3">
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-indigo-700 transition hover:border-indigo-400 hover:bg-indigo-50/50"
              >
                <Plus className="h-4 w-4" />
                Add plugin
              </button>
            </div>
          </aside>

          <main className="min-w-0 flex-1 p-6">
            {selected ? (
              <ProviderDetailPanel
                key={selected.provider}
                provider={selected}
                plugin={selectedPlugin}
                adminAuthProvider={adminAuthProvider}
                adminOnlyProviderIds={adminOnlyProviderIds}
                onUpdated={load}
                onDeleted={(id) => {
                  setSelectedId(null);
                  load();
                  const remaining = providers.filter((p) => p.provider !== id);
                  if (remaining[0]) setSelectedId(remaining[0].provider);
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-slate-500">
                <p className="text-sm">No providers yet.</p>
                <Button type="button" className="mt-4" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Add plugin
                </Button>
              </div>
            )}
          </main>
        </div>
      </Card>

      <AddPluginDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={load} />
    </>
  );
}
