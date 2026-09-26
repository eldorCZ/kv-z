// Writes .br and .gz next to every text asset of the build; the server sends them as they are
// (@fastify/static preCompressed), so phones get small files without compressing on every request (V11.2).
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = new URL('./dist/', import.meta.url).pathname;
const TEXT = /\.(js|css|html|svg|json|webmanifest|txt)$/;
let n = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (TEXT.test(name) && statSync(p).size >= 1024) {
      const buf = readFileSync(p);
      writeFileSync(`${p}.br`, brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
      writeFileSync(`${p}.gz`, gzipSync(buf, { level: 9 }));
      n++;
    }
  }
};
walk(root);
console.log(`precompressed ${n} files`);
