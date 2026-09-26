// Bundles the server together with the workspace packages (@kvizhub/*, TypeScript sources)
// into dist/index.js. Third-party runtime dependencies stay external and are installed in the image.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@kvizhub/'));
const exportPkg = JSON.parse(readFileSync(new URL('../../packages/export/package.json', import.meta.url), 'utf8'));
const corePkg = JSON.parse(readFileSync(new URL('../../packages/core/package.json', import.meta.url), 'utf8'));
for (const p of [exportPkg, corePkg]) for (const d of Object.keys(p.dependencies ?? {})) if (!d.startsWith('@kvizhub/')) external.push(d);

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [...new Set(external)],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
console.log('server built -> dist/index.js');
