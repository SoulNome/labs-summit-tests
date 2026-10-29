// Levanta una copia local del sitio con `wrangler pages dev`, que aplica igual que Cloudflare Pages
// el archivo _headers, _routes.json y la función functions/[[ruta]].js.
// Con BASE_URL=https://… las pruebas van contra un sitio ya publicado (solo peticiones GET normales).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
export const SITIO_DIR = path.resolve(process.env.SITIO_DIR || path.join(aqui, '..', '..', 'labs-summit-2026'));

function puertoLibre() {
  return new Promise((ok, mal) => {
    const s = createServer();
    s.once('error', mal);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

export async function iniciarSitio() {
  if (process.env.BASE_URL) return { url: process.env.BASE_URL.replace(/\/+$/, ''), remoto: true, cerrar: async () => {} };
  const puerto = await puertoLibre();
  const bin = path.join(aqui, '..', 'node_modules', '.bin', 'wrangler');
  // Se arranca DESDE la carpeta del sitio: así wrangler encuentra functions/ (la función que responde 403),
  // igual que Cloudflare Pages con la raíz del repo. El estado temporal va a una carpeta del sistema.
  const estado = mkdtempSync(path.join(tmpdir(), 'wrangler-'));
  const hijo = spawn(bin, ['pages', 'dev', '.', '--port', String(puerto), '--ip', '127.0.0.1', '--compatibility-date=2026-10-01', '--persist-to', estado], {
    cwd: SITIO_DIR,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });
  let salida = '';
  hijo.stdout.on('data', (d) => { salida += d; });
  hijo.stderr.on('data', (d) => { salida += d; });
  const url = `http://127.0.0.1:${puerto}`;
  const limite = Date.now() + 60000;
  for (;;) {
    if (hijo.exitCode !== null) throw new Error('wrangler se cerró:\n' + salida.slice(-2000));
    try { const r = await fetch(url + '/robots.txt'); if (r.ok) break; } catch { /* aún arrancando */ }
    if (Date.now() > limite) { process.kill(-hijo.pid, 'SIGTERM'); throw new Error('wrangler no arrancó a tiempo:\n' + salida.slice(-2000)); }
    await new Promise((r) => setTimeout(r, 300));
  }
  return {
    url,
    remoto: false,
    cerrar: async () => {
      try { process.kill(-hijo.pid, 'SIGTERM'); } catch { /* ya cerrado */ }
      await new Promise((r) => setTimeout(r, 300));
    }
  };
}
