// Empaqueta herramientas/drand-bls/entrada.js en un solo archivo para la web.
// Uso: npm run construir:drand-bls   (SITIO_DIR apunta al repo labs-summit-2026; por defecto ../labs-summit-2026)
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const sitio = path.resolve(process.env.SITIO_DIR || path.join(aqui, '..', '..', 'labs-summit-2026'));
const salida = path.join(sitio, 'sorteos', 'vendor', 'drand-bls.min.js');
const version = (p) => JSON.parse(readFileSync(path.join(aqui, '..', 'node_modules', p, 'package.json'), 'utf8')).version;

await build({
  entryPoints: [path.join(aqui, 'drand-bls', 'entrada.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'LSDrandBLS',
  platform: 'browser',
  target: ['es2020'],
  legalComments: 'inline',
  outfile: salida,
  banner: {
    js: `/* Labs Summit 2026 · verificación de firmas drand (bls-unchained-g1-rfc9380).
   Generado con labs-summit-tests/herramientas/construir-drand-bls.mjs
   @noble/curves ${version('@noble/curves')} y @noble/hashes ${version('@noble/hashes')} (MIT, Paul Miller · paulmillr.com). No editar a mano. */`
  },
  footer: { js: 'if(typeof module==="object"&&module.exports)module.exports=LSDrandBLS;' }
});
console.log('Listo:', salida);
