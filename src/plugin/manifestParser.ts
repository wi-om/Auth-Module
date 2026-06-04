import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { validatePluginManifest, type ProviderPluginManifest } from './manifestSchema';

const MAX_UPLOAD_BYTES = 512 * 1024;
const MANIFEST_NAMES = new Set(['plugin.json', 'manifest.json', 'provider.json']);

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseJsonManifest(buffer: Buffer): unknown {
  const text = buffer.toString('utf8').trim();
  if (!text) throw new Error('Manifest file is empty');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Invalid JSON manifest');
  }
}

function stripCommentsAndTypes(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Line comments only — do not strip `//` inside URLs (https://...)
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*import\s+.+$/gm, '')
    .replace(/^\s*export\s+type\s+.+$/gm, '')
    .replace(/^\s*interface\s+[\s\S]*?^\s*\}\s*;?\s*$/gm, '')
    .replace(/^\s*type\s+\w+\s*=[\s\S]*?;\s*$/gm, '');
}

/** Extract a balanced `{ ... }` object literal starting at openBraceIndex. */
function extractBalancedObject(source: string, openBraceIndex: number): string | null {
  if (source[openBraceIndex] !== '{') return null;

  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let i = openBraceIndex; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === stringChar) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(openBraceIndex, i + 1);
    }
  }
  return null;
}

function jsObjectLiteralToJsonText(objectLiteral: string): string {
  return objectLiteral
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/'/g, '"')
    .replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":');
}

function objectLiteralToJson(objectLiteral: string): unknown {
  const strict = objectLiteral.replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(strict) as unknown;
  } catch {
    try {
      return JSON.parse(jsObjectLiteralToJsonText(objectLiteral)) as unknown;
    } catch {
      throw new Error('Could not parse exported manifest object as JSON');
    }
  }
}

function parseObjectAtBrace(text: string, braceIndex: number): unknown {
  const literal = extractBalancedObject(text, braceIndex);
  if (!literal) throw new Error('Could not read plugin manifest object');
  return objectLiteralToJson(literal);
}

/** Extract manifest from .js/.ts (inline export, module.exports, or const + export default). */
function parseJsTsManifest(buffer: Buffer): unknown {
  const raw = buffer.toString('utf8').trim();
  if (raw.startsWith('{')) {
    return parseJsonManifest(buffer);
  }

  const text = stripCommentsAndTypes(raw);

  const inlineExport = text.match(/export\s+default\s*\{/);
  if (inlineExport?.index !== undefined) {
    const braceIndex = text.indexOf('{', inlineExport.index);
    return parseObjectAtBrace(text, braceIndex);
  }

  const moduleExport = text.match(/module\.exports\s*=\s*\{/);
  if (moduleExport?.index !== undefined) {
    const braceIndex = text.indexOf('{', moduleExport.index);
    return parseObjectAtBrace(text, braceIndex);
  }

  const exportId = text.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/);
  if (exportId?.[1]) {
    const name = exportId[1];
    const assignPattern = new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=]+)?=\\s*\\{`);
    const assign = text.match(assignPattern);
    if (assign?.index !== undefined) {
      const braceIndex = text.indexOf('{', assign.index);
      return parseObjectAtBrace(text, braceIndex);
    }
  }

  const namedConst = text.match(/(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*\{/);
  if (namedConst?.index !== undefined) {
    const braceIndex = text.indexOf('{', namedConst.index);
    return parseObjectAtBrace(text, braceIndex);
  }

  throw new Error(
    'JS/TS plugin files must export a manifest object (export default { ... }, export default name, or module.exports = { ... })'
  );
}

function findManifestInZip(zip: AdmZip): { buffer: Buffer; name: string } {
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && MANIFEST_NAMES.has(e.entryName.split('/').pop() || ''));

  if (entries.length === 0) {
    throw new Error('ZIP must contain plugin.json, manifest.json, or provider.json at root or one folder deep');
  }

  const entry = entries[0];
  const buffer = entry.getData();
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('Manifest inside ZIP exceeds size limit');
  }
  return { buffer, name: entry.entryName };
}

export type ParsedPluginUpload = {
  manifest: ProviderPluginManifest;
  checksum: string;
  sourceFilename: string;
};

export function parsePluginUpload(
  buffer: Buffer,
  originalFilename: string,
  options: { allowLocalhostUrls?: boolean } = {}
): ParsedPluginUpload {
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Plugin file exceeds ${MAX_UPLOAD_BYTES} bytes`);
  }

  const lower = originalFilename.toLowerCase();
  let manifestRaw: unknown;
  let sourceFilename = originalFilename;

  if (lower.endsWith('.zip')) {
    const zip = new AdmZip(buffer);
    const { buffer: manifestBuffer, name } = findManifestInZip(zip);
    manifestRaw = parseJsonManifest(manifestBuffer);
    sourceFilename = `${originalFilename}:${name}`;
  } else if (lower.endsWith('.json')) {
    manifestRaw = parseJsonManifest(buffer);
  } else if (lower.endsWith('.js') || lower.endsWith('.ts')) {
    manifestRaw = parseJsTsManifest(buffer);
  } else {
    throw new Error('Unsupported file type. Upload .json, .js, .ts, or .zip containing a manifest');
  }

  const manifest = validatePluginManifest(manifestRaw, options);
  return {
    manifest,
    checksum: sha256(buffer),
    sourceFilename,
  };
}
