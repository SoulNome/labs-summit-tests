// Levanta una copia local del sitio con `wrangler pages dev`, que aplica igual que Cloudflare Pages
// el archivo _headers, _routes.json y las funciones de functions/.
// Con BASE_URL=https://… las pruebas van contra un sitio ya publicado (solo peticiones GET normales).
// Con { registro: true } el sitio arranca como en producción ya configurada: una base D1 local
// enlazada como SORTEO_DB y la clave SORTEO_CLAVE (ver CLAVE_PRUEBA).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
export const SITIO_DIR = path.resolve(process.env.SITIO_DIR || path.join(aqui, '..', '..', 'labs-summit-2026'));

const repartidos = new Set();   // nunca el mismo puerto dos veces en una corrida
function puertoLibre() {
  return new Promise((ok, mal) => {
    const s = createServer();
    s.once('error', mal);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  }).then((p) => (repartidos.has(p) ? puertoLibre() : (repartidos.add(p), p)));
}

export const CLAVE_PRUEBA = 'clave-de-prueba-larga-123';

export async function iniciarSitio(op = {}) {
  if (process.env.BASE_URL) return { url: process.env.BASE_URL.replace(/\/+$/, ''), remoto: true, cerrar: async () => {} };
  // Puerto propio también para el inspector: si no, dos copias que arrancan a la vez chocan en el 9229
  const [puerto, inspector] = [await puertoLibre(), await puertoLibre()];
  const extra = op.registro ? ['--d1', 'SORTEO_DB', '--binding', 'SORTEO_LIMITE_IP=' + (op.limiteIp || 1500)] : [];
  if (op.registro && !op.sinClave) extra.push('--binding', 'SORTEO_CLAVE=' + (op.clave || CLAVE_PRUEBA));
  for (const b of op.variables || []) extra.push('--binding', b);   // p. ej. una configuración equivocada de Cloudflare
  const bin = path.join(aqui, '..', 'node_modules', '.bin', 'wrangler');
  // Se arranca DESDE la carpeta del sitio: así wrangler encuentra functions/ (la función que responde 403),
  // igual que Cloudflare Pages con la raíz del repo. El estado temporal va a una carpeta del sistema.
  const estado = mkdtempSync(path.join(tmpdir(), 'wrangler-'));
  const hijo = spawn(bin, ['pages', 'dev', '.', '--port', String(puerto), '--ip', '127.0.0.1', '--compatibility-date=2026-10-01', '--persist-to', estado, '--inspector-port', String(inspector), ...extra], {
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
  // Si la corrida se interrumpe (Ctrl+C, límite de tiempo), wrangler no queda vivo en segundo plano
  const matar = () => { try { process.kill(-hijo.pid, 'SIGTERM'); } catch { /* ya cerrado */ } };
  process.once('exit', matar);
  for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => { matar(); process.exit(130); });
  return {
    url,
    remoto: false,
    cerrar: async () => {
      matar();
      await new Promise((r) => setTimeout(r, 300));
    }
  };
}
