import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Upload, X } from 'lucide-react';
import { fetchPluginCatalog, installPlugin, uploadPlugin } from '../api/setupApi';
import type { CatalogPlugin } from '../types';
import { toastFromError, toastSuccess } from '../utils/toast';
import { Button } from './ui';
import { ProviderIcon } from './ProviderIcon';

type Props = {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
};

export function AddPluginDialog({ open, onClose, onAdded }: Props) {
  const [catalog, setCatalog] = useState<CatalogPlugin[]>([]);
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchPluginCatalog()
      .then((data) => {
        setCatalog(data.catalog || []);
        setInstalledIds((data.installedIds || []).map((id) => id.toLowerCase()));
      })
      .catch((e) => toastFromError(e, 'Could not load plugin store'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const addFromStore = async (item: CatalogPlugin) => {
    if (installedIds.includes(item.id.toLowerCase())) {
      toastSuccess(`${item.label} is already configured for end-user sign-in`);
      onAdded();
      onClose();
      return;
    }
    setBusyId(item.id);
    try {
      const r = await installPlugin(item.id);
      toastSuccess(r.message);
      onAdded();
      onClose();
    } catch (e) {
      toastFromError(e, 'Could not add plugin');
    } finally {
      setBusyId(null);
    }
  };

  const onUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toastFromError(new Error('Choose a .json manifest file'), 'Upload');
      return;
    }
    setUploading(true);
    try {
      const r = await uploadPlugin(file);
      toastSuccess(r.message);
      if (fileRef.current) fileRef.current.value = '';
      onAdded();
      onClose();
    } catch (e) {
      toastFromError(e, 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal>
      <div className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="font-semibold text-slate-900">Add plugin</h3>
            <p className="text-sm text-slate-500">
              Add providers for <strong>product sign-in</strong>. Admin sign-in (step 2) is separate — same
              name here uses new credentials.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex justify-center py-8 text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <ul className="space-y-2">
              {catalog.map((item) => {
                const installed = installedIds.includes(item.id.toLowerCase());
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => addFromStore(item)}
                      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-60"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-100 bg-white">
                        <ProviderIcon providerId={item.id} type={item.plugin_type} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">{item.label}</p>
                        <p className="text-xs text-slate-500 capitalize">
                          {item.plugin_type}
                          {item.version !== 'builtin' ? ` · v${item.version}` : ' · built-in'}
                        </p>
                      </div>
                      {installed ? (
                        <span className="text-xs font-medium text-emerald-600">In providers</span>
                      ) : busyId === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                      ) : (
                        <Plus className="h-4 w-4 text-indigo-600" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Custom plugin not listed?
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="min-w-0 flex-1 text-sm text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
            <Button type="button" onClick={onUpload} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
