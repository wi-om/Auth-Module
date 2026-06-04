import fs from 'fs';
import path from 'path';
import { validatePluginManifest, type ProviderPluginManifest } from './plugin/manifestSchema';

export type CatalogPlugin = {
  id: string;
  label: string;
  version: string;
  plugin_type: 'oauth' | 'passkey' | 'password';
  description?: string;
};

const EXAMPLES_DIR = path.resolve(process.cwd(), 'plugins', 'examples');

const BUILTIN_PASSWORD: CatalogPlugin = {
  id: 'password',
  label: 'Email & Password',
  version: 'builtin',
  plugin_type: 'password',
  description: 'Built-in email and password sign-in',
};

/** Built-in + manifest files under plugins/examples (plugin store). */
export function listPluginCatalog(): CatalogPlugin[] {
  const items: CatalogPlugin[] = [BUILTIN_PASSWORD];
  const seen = new Set<string>(['password']);

  if (!fs.existsSync(EXAMPLES_DIR)) {
    return items;
  }

  for (const name of fs.readdirSync(EXAMPLES_DIR)) {
    if (!name.endsWith('.json')) continue;
    const filePath = path.join(EXAMPLES_DIR, name);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      const manifest = validatePluginManifest(raw);
      const id = manifest.id.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({
        id,
        label: manifest.label,
        version: manifest.version,
        plugin_type: manifest.type,
      });
    } catch {
      // skip invalid example files
    }
  }

  return items.sort((a, b) => {
    if (a.id === 'password') return -1;
    if (b.id === 'password') return 1;
    return a.label.localeCompare(b.label);
  });
}

export function readExamplePluginManifest(pluginId: string): ProviderPluginManifest {
  const id = pluginId.toLowerCase();
  if (id === 'password') {
    throw new Error('Password provider is built-in and cannot be installed from a file');
  }
  if (!fs.existsSync(EXAMPLES_DIR)) {
    throw new Error('Plugin catalog directory not found');
  }

  const match = fs
    .readdirSync(EXAMPLES_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => path.join(EXAMPLES_DIR, n))
    .find((filePath) => {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
        const m = validatePluginManifest(raw);
        return m.id.toLowerCase() === id;
      } catch {
        return false;
      }
    });

  if (!match) {
    throw new Error(`No catalog plugin found for "${pluginId}"`);
  }

  const raw = JSON.parse(fs.readFileSync(match, 'utf8')) as unknown;
  return validatePluginManifest(raw);
}

export function exampleFilenameForPlugin(pluginId: string): string {
  return path.basename(
    fs
      .readdirSync(EXAMPLES_DIR)
      .filter((n) => n.endsWith('.json'))
      .find((n) => {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, n), 'utf8')) as unknown;
          const m = validatePluginManifest(raw);
          return m.id.toLowerCase() === pluginId.toLowerCase();
        } catch {
          return false;
        }
      }) || `${pluginId}.plugin.json`
  );
}
