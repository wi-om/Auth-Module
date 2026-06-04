import { useEffect, useState } from 'react';
import { Copy, Loader2, Save, Trash2 } from 'lucide-react';
import { deletePlugin, saveProvider } from '../api/setupApi';
import type { PluginRow, ProviderRow } from '../types';
import { isAdminOnlyProductProvider } from '../types';
import { toastFromError, toastSuccess } from '../utils/toast';
import { Badge, Button, Input, Label } from './ui';
import { ProviderIcon } from './ProviderIcon';

type Props = {
  provider: ProviderRow;
  plugin?: PluginRow;
  adminAuthProvider?: string | null;
  adminOnlyProviderIds?: string[];
  onUpdated: () => void;
  onDeleted?: (id: string) => void;
};

function displayLabel(id: string, plugin?: PluginRow): string {
  if (id === 'password') return 'Email & Password';
  return plugin?.label || id;
}

export function ProviderDetailPanel({
  provider,
  plugin,
  adminAuthProvider,
  adminOnlyProviderIds,
  onUpdated,
  onDeleted,
}: Props) {
  const id = provider.provider;
  const isAdminOnly = isAdminOnlyProductProvider(
    id,
    provider,
    adminAuthProvider,
    adminOnlyProviderIds
  );
  const isPassword = id === 'password';
  const type = isPassword ? 'password' : (plugin?.plugin_type || 'oauth');
  const label = displayLabel(id, plugin);

  const [enabled, setEnabled] = useState(isAdminOnly ? false : provider.enabled);
  const [clientId, setClientId] = useState(isAdminOnly ? '' : provider.client_id || '');
  const [clientSecret, setClientSecret] = useState('');
  const [tenantId, setTenantId] = useState(isAdminOnly ? '' : provider.extra_config?.tenantId || '');
  const redirectUri = provider.extra_config?.redirectUri || '';
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const adminOnly = isAdminOnlyProductProvider(
      id,
      provider,
      adminAuthProvider,
      adminOnlyProviderIds
    );
    setEnabled(adminOnly ? false : provider.enabled);
    setClientId(adminOnly ? '' : provider.client_id || '');
    setClientSecret('');
    setTenantId(adminOnly ? '' : provider.extra_config?.tenantId || '');
  }, [provider, adminAuthProvider, adminOnlyProviderIds, id]);

  const copyRedirect = async () => {
    if (!redirectUri) return;
    await navigator.clipboard.writeText(redirectUri);
    toastSuccess('Redirect URI copied');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Parameters<typeof saveProvider>[1] = {
        enabled,
        clientId,
        extraConfig: { tenantId, redirectUri },
      };
      if (clientSecret.trim()) body.clientSecret = clientSecret;
      const r = await saveProvider(id, body);
      toastSuccess(r.message);
      onUpdated();
    } catch (e) {
      toastFromError(e, 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove "${label}" from your providers?`)) return;
    setSaving(true);
    try {
      const r = await deletePlugin(id);
      toastSuccess(r.message);
      onDeleted?.(id);
      onUpdated();
    } catch (e) {
      toastFromError(e, 'Remove failed');
    } finally {
      setSaving(false);
    }
  };

  const configured =
    isPassword || (type !== 'oauth' ? true : Boolean(clientId.trim() || provider.client_id));

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="flex gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
            <ProviderIcon providerId={id} type={type} className="h-7 w-7" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{label}</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              {type}
              {plugin?.version ? ` · v${plugin.version}` : isPassword ? ' · builtin' : ''}
              {configured ? ' · configured' : ' · needs credentials'}
            </p>
          </div>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
          />
          Enabled
        </label>
      </header>

      <div className="flex-1 py-5">
        {isPassword ? (
          <p className="text-sm leading-relaxed text-slate-600">
            Email and password sign-in is always available when enabled. No OAuth credentials are required.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Client ID</Label>
              <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="From your IdP app registration" />
            </div>
            <div className="sm:col-span-2">
              <Label>Client secret</Label>
              <Input
                type="password"
                placeholder="Leave blank to keep existing"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
            <div>
              <Label>Tenant ID (optional)</Label>
              <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Microsoft Entra only" />
            </div>
            <div>
              <Label>Redirect URI</Label>
              <div className="flex gap-2">
                <Input readOnly value={redirectUri} className="font-mono text-xs bg-slate-50" />
                {redirectUri ? (
                  <Button type="button" variant="secondary" className="shrink-0 px-3" onClick={copyRedirect} title="Copy">
                    <Copy className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {!isPassword && plugin ? (
          <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
            <Badge tone={type === 'passkey' ? 'passkey' : 'oauth'}>{type}</Badge>
            Plugin id: {plugin.id}
          </p>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
        {!isPassword ? (
          <Button type="button" variant="danger" onClick={handleDelete} disabled={saving} className="mr-auto">
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => onUpdated()} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </Button>
      </footer>
    </div>
  );
}
