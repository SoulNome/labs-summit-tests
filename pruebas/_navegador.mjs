// Ayudas para las pruebas con navegador (Chromium de Playwright).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

/**
 * Página nueva que anota errores, violaciones de CSP, ventanas emergentes (alert) y peticiones.
 * Sin internet: todo lo externo se corta, salvo lo que cada prueba simule con page.route().
 * op.prueba: valor de window.__LS_SORTEO_PRUEBA (cadena de drand de prueba).
 */
export async function nuevaPagina(navegador, sitio, op = {}) {
  const ctx = await navegador.newContext({ acceptDownloads: true, locale: 'es-CO', timezoneId: 'America/Bogota', serviceWorkers: op.serviceWorkers || 'block' });
  const page = await ctx.newPage();
  const reg = { errores: [], csp: [], dialogos: [], peticiones: [] };
  page.on('pageerror', (e) => reg.errores.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && m.text().startsWith('CSP ')) reg.csp.push(m.text()); });
  page.on('dialog', (d) => { reg.dialogos.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('request', (r) => reg.peticiones.push(r.url()));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error('CSP ' + e.violatedDirective + ' ' + e.blockedURI));
  });
  if (op.prueba) await page.addInitScript((p) => { window.__LS_SORTEO_PRUEBA = p; }, op.prueba);
  const propio = new URL(sitio.url).origin;
  if (op.bloquearExternos !== false) {
    await ctx.route((u) => u.protocol === 'https:' && u.origin !== propio, (r) => r.abort('internetdisconnected'));
  }
  return { ctx, page, reg };
}

/** Hosts externos a los que intentó conectarse la página. */
export function hostsExternos(reg, sitio) {
  const propio = new URL(sitio.url).host;
  return [...new Set(reg.peticiones.map((u) => { try { return new URL(u); } catch { return null; } })
    .filter((u) => u && /^https?:$/.test(u.protocol) && u.host !== propio).map((u) => u.host))];
}

/** Responde la ronda de drand simulada en todos los relevos permitidos por la CSP. */
export async function simularDrand(page, responder) {
  await page.route(/^https:\/\/(api\d?\.drand\.sh|drand\.cloudflare\.com)\//, responder);
}
export function jsonCors(cuerpo, status = 200) {
  return { status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) };
}
