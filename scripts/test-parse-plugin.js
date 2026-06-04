const fs = require('fs');
const path = require('path');
const { parsePluginUpload } = require('../dist/plugin/manifestParser');

for (const file of ['plugins/examples/github.ts', 'plugins/examples/facebook.js', 'plugins/examples/google.plugin.json']) {
  const buffer = fs.readFileSync(path.join(__dirname, '..', file));
  try {
    const result = parsePluginUpload(buffer, path.basename(file));
    console.log('OK', file, '->', result.manifest.id);
  } catch (e) {
    console.error('FAIL', file, e.message);
    if (e.message.includes('JSON')) {
      const raw = buffer.toString('utf8');
      const text = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const m = text.match(/export\s+default\s*\{/);
      const brace = text.indexOf('{', m.index);
      let depth = 0,
        inStr = false,
        sc = '',
        esc = false,
        end = -1;
      for (let i = brace; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
          if (esc) {
            esc = false;
            continue;
          }
          if (c === '\\') {
            esc = true;
            continue;
          }
          if (c === sc) inStr = false;
          continue;
        }
        if (c === '"' || c === "'") {
          inStr = true;
          sc = c;
          continue;
        }
        if (c === '{') depth++;
        if (c === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const lit = text.slice(brace, end + 1);
      const norm = lit.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"');
      console.error('First 300 chars normalized:', norm.slice(0, 300));
      try {
        JSON.parse(norm);
      } catch (je) {
        console.error('JSON error:', je.message);
      }
    }
    process.exitCode = 1;
  }
}
