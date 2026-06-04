import type { ProviderPluginManifest } from './manifestSchema';

export type PluginRecord = {
  id: string;
  label: string;
  version: string;
  pluginType: 'oauth' | 'passkey';
  manifest: ProviderPluginManifest;
  sourceFilename: string;
  sourceChecksum: string;
  createdAt: string;
  updatedAt: string;
};

const pluginsById = new Map<string, PluginRecord>();

export async function listPlugins(): Promise<PluginRecord[]> {
  return [...pluginsById.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export async function getPluginById(id: string): Promise<PluginRecord | null> {
  return pluginsById.get(id) || null;
}

export async function pluginExists(id: string): Promise<boolean> {
  return pluginsById.has(id);
}

export async function registerPlugin(
  manifest: ProviderPluginManifest,
  sourceFilename: string,
  sourceChecksum: string
): Promise<PluginRecord> {
  const now = new Date().toISOString();
  const record: PluginRecord = {
    id: manifest.id,
    label: manifest.label,
    version: manifest.version,
    pluginType: manifest.type === 'passkey' ? 'passkey' : 'oauth',
    manifest,
    sourceFilename,
    sourceChecksum,
    createdAt: pluginsById.get(manifest.id)?.createdAt || now,
    updatedAt: now,
  };
  pluginsById.set(manifest.id, record);
  return record;
}

export async function deletePlugin(id: string): Promise<boolean> {
  return pluginsById.delete(id);
}

export function loadPluginsFromProductBootstrap(
  rows: Array<{
    id: string;
    label: string;
    version: string;
    plugin_type: 'oauth' | 'passkey';
    manifest: ProviderPluginManifest;
    source_filename: string;
    source_checksum: string;
    created_at?: string | Date;
    updated_at?: string | Date;
  }>
): void {
  pluginsById.clear();
  rows.forEach((row) => {
    const createdAt = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString();
    const updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : createdAt;
    pluginsById.set(row.id, {
      id: row.id,
      label: row.label,
      version: row.version,
      pluginType: row.plugin_type === 'passkey' ? 'passkey' : 'oauth',
      manifest: row.manifest,
      sourceFilename: row.source_filename,
      sourceChecksum: row.source_checksum,
      createdAt,
      updatedAt,
    });
  });
}
