// npm run sitio → copia local del sitio en http://127.0.0.1:8788 con las mismas cabeceras y rutas de Cloudflare Pages.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const sitio = path.resolve(process.env.SITIO_DIR || path.join(aqui, '..', '..', 'labs-summit-2026'));
const puerto = process.env.PUERTO || '8788';
spawn(path.join(aqui, '..', 'node_modules', '.bin', 'wrangler'), ['pages', 'dev', '.', '--port', puerto, '--ip', '127.0.0.1', '--compatibility-date=2026-10-01'], {
  cwd: sitio,   // desde la carpeta del sitio, para que wrangler encuentre functions/
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  stdio: 'inherit'
}).on('exit', (c) => process.exit(c ?? 0));
