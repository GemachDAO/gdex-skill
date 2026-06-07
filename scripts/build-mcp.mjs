import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';

// Bundle the MCP server into a single self-contained file so it ships prebuilt
// (committed to git) and runs straight from a GitHub install via the
// `gdex-mcp-server` bin — no install-time build, no `file:..` self-dependency.
//
// ESM output is required (the entry uses top-level await and import.meta.url),
// so a createRequire shim is injected for the bundled CommonJS dependencies
// (axios -> form-data -> combined-stream) that call require() at runtime.

const OUT = 'mcp-server/dist/index.js';

await build({
  entryPoints: ['mcp-server/src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: OUT,
  alias: { '@gdexsdk/gdex-skill': './dist/index.js' },
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __gdexCreateRequire } from 'node:module';",
      'const require = __gdexCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'info',
});

await chmod(OUT, 0o755);
