import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';

const SRC = path.resolve('src');
const MOCK = '/private/tmp/claude-501/-Users-yaswanthsaigonuguntla-Documents-CareersPortal/eeb56e10-b3cb-4eb5-aa1b-d93e2c914f31/scratchpad/harness/mockClient.js';

// Intercept every resolution that lands on src/api/client.js — the pages reach
// it via '@/api/client' but the api modules use a relative './client', so a
// plain path alias would only catch half of them.
const mockClientPlugin = {
  name: 'mock-client',
  setup(build) {
    build.onResolve({ filter: /(^|\/)client(\.js)?$/ }, (args) => {
      if (!args.importer.includes(path.join('src', 'api'))
          && !args.path.startsWith('@/api/')) return null;
      return { path: MOCK };
    });
    build.onResolve({ filter: /^@\// }, (args) => {
      const base = path.join(SRC, args.path.slice(2));
      for (const cand of [base, base + '.jsx', base + '.js',
                          path.join(base, 'index.jsx'), path.join(base, 'index.js')]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return { path: cand };
      }
      return { path: base };
    });
  },
};

await esbuild.build({
  entryPoints: ['.harness-entry.jsx'],
  bundle: true,
  outfile: '/private/tmp/claude-501/-Users-yaswanthsaigonuguntla-Documents-CareersPortal/eeb56e10-b3cb-4eb5-aa1b-d93e2c914f31/scratchpad/harness/bundle.js',
  jsx: 'automatic',
  format: 'iife',
  loader: { '.jsx': 'jsx' },
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.VITE_API_URL': '""' },
  plugins: [mockClientPlugin],
  logLevel: 'warning',
});
console.log('BUNDLED');
