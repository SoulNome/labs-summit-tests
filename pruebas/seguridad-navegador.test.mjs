// Ataques desde el navegador: enlaces con código malicioso (XSS), inyección de HTML y rastreadores.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarSitio } from './_sitio.mjs';
import { chromium, nuevaPagina, hostsExternos } from './_navegador.mjs';

let sitio, nav;
before(async () => { sitio = await iniciarSitio(); nav = await chromium.launch(); });
after(async () => { await nav?.close(); await sitio?.cerrar(); });

// Cada carga intenta ejecutar código; si lo logra, deja window.__xss = 1 o abre un alert.
const CARGAS = [
  '"><img src=x onerror="window.__xss=1">',
  "'><svg/onload=window.__xss=1>",
  '<script>window.__xss=1</script>',
  'javascript:window.__xss=1',
  '__proto__',
  'constructor',
  '%E0%A4%A'
];
const RUTAS = {
  'inicio (query y #)': (c) => '/?q=' + encodeURIComponent(c) + '#' + encodeURIComponent(c),
  'mapa ?z=': (c) => '/mapa/?lista&z=' + encodeURIComponent(c),
  'mapa ?p= (QR)': (c) => '/mapa/?lista&p=' + encodeURIComponent(c),
  'mapa ?t=': (c) => '/mapa/?lista&t=' + encodeURIComponent(c),
  'speakers #': (c) => '/speakers#' + (c.startsWith('%') ? c : encodeURIComponent(c)),
  'sorteos ?id=': (c) => '/sorteos/?id=' + encodeURIComponent(c),
  'pantalla del sorteo': (c) => '/sorteos/?pantalla&id=' + encodeURIComponent(c)
};

describe('enlaces manipulados (XSS) no ejecutan código ni rompen la página', () => {
  for (const [nombre, ruta] of Object.entries(RUTAS)) {
    test(nombre, async () => {
      const { ctx, page, reg } = await nuevaPagina(nav, sitio);
      try {
        for (const c of CARGAS) {
          await page.goto(sitio.url + ruta(c), { waitUntil: 'load' });
          await page.waitForTimeout(700);
          const x = await page.evaluate(() => ({
            xss: window.__xss,
            inyectado: document.querySelectorAll('img[src="x"], svg[onload], script:not([src])[data-xss]').length,
            texto: document.body ? document.body.innerText.length : 0
          }));
          assert.equal(x.xss, undefined, `${nombre} con ${c}: se ejecutó código`);
          assert.equal(x.inyectado, 0, `${nombre} con ${c}: se inyectó HTML`);
          assert.ok(x.texto > 50, `${nombre} con ${c}: la página quedó en blanco`);
        }
        assert.deepEqual(reg.dialogos, [], 'ninguna ventana emergente');
        assert.deepEqual(reg.errores, [], 'sin errores de JavaScript');
      } finally { await ctx.close(); }
    });
  }
  test('un id de sorteo con ruta no se pide al servidor', async () => {
    const { ctx, page, reg } = await nuevaPagina(nav, sitio);
    try {
      await page.goto(sitio.url + '/sorteos/?id=' + encodeURIComponent('../../_headers'));
      await page.waitForSelector('.aviso-error');
      assert.match(await page.textContent('.aviso-error'), /no es válido/);
      assert.ok(!reg.peticiones.some((u) => decodeURIComponent(new URL(u).pathname).includes('_headers')), 'no pidió el archivo');
      assert.ok(!reg.peticiones.some((u) => new URL(u).pathname.startsWith('/sorteos/datos/')), 'no pidió ningún archivo de sorteo');
    } finally { await ctx.close(); }
  });
});

describe('páginas de sorteos blindadas', () => {
  for (const ruta of ['/sorteos/', '/sorteos/organizador']) {
    test(ruta + ': el navegador bloquea HTML y scripts inyectados (Trusted Types + CSP)', async () => {
      const { ctx, page } = await nuevaPagina(nav, sitio);
      try {
        await page.goto(sitio.url + ruta);
        const r = await page.evaluate(() => {
          const out = {};
          try { document.body.insertAdjacentHTML('beforeend', '<img src=x onerror="window.__xss=1">'); out.html = 'permitido'; } catch (e) { out.html = e.name; }
          try { const s = document.createElement('script'); s.textContent = 'window.__xss=2'; document.body.appendChild(s); out.script = 'insertado'; } catch (e) { out.script = e.name; }
          try { const s = document.createElement('script'); s.src = 'https://evil.example/x.js'; document.body.appendChild(s); out.externo = 'insertado'; } catch (e) { out.externo = e.name; }
          return out;
        });
        await page.waitForTimeout(300);
        assert.equal(r.html, 'TypeError', 'innerHTML/insertAdjacentHTML con texto queda prohibido');
        assert.equal(r.script, 'TypeError', 'no se puede crear un script en línea');
        assert.equal(r.externo, 'TypeError', 'no se puede cargar un script de otro dominio');
        assert.equal(await page.evaluate(() => window.__xss), undefined);
      } finally { await ctx.close(); }
    });
    test(ruta + ': sin analítica ni rastreadores (Clarity graba la pantalla)', async () => {
      const { ctx, page, reg } = await nuevaPagina(nav, sitio);
      try {
        await page.goto(sitio.url + ruta, { waitUntil: 'load' });
        await page.waitForTimeout(800);
        const externos = hostsExternos(reg, sitio);
        assert.deepEqual(externos.filter((h) => !/^fonts\.(googleapis|gstatic)\.com$/.test(h)), [], 'solo fuentes de Google');
        assert.deepEqual(reg.csp, [], 'sin violaciones de CSP');
        assert.deepEqual(reg.errores, []);
      } finally { await ctx.close(); }
    });
  }
  test('la herramienta del organizador no deja salir la lista de compradores', async () => {
    const { ctx, page, reg } = await nuevaPagina(nav, sitio);
    try {
      await page.goto(sitio.url + '/sorteos/organizador');
      await page.fill('#o-pegar', 'Nombre\tCédula\tCódigo\nAna Gómez\t1116234567\tLS-1\nLuis Peña\t94555111\tLS-2');
      await page.click('#o-leer');
      await page.fill('#o-titulo', 'Prueba de privacidad');
      await page.fill('#o-premios', 'Bono');
      await page.fill('#o-hora', new Date(Date.now() + 15 * 60e3 - 5 * 3600e3).toISOString().slice(0, 16));
      await page.click('#o-generar');
      await page.waitForSelector('#paso4:not([hidden])');
      const fuera = reg.peticiones.filter((u) => !u.startsWith(sitio.url) && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
      assert.deepEqual(fuera, [], 'ninguna petición a otros servidores');
      assert.ok(!reg.peticiones.some((u) => /1116234567|G%C3%B3mez|Gomez/.test(u)), 'los datos no viajan en ninguna URL');
    } finally { await ctx.close(); }
  });
});

describe('sin errores ni violaciones de CSP al navegar normalmente', () => {
  for (const ruta of ['/', '/speakers', '/mapa/?lista', '/politica', '/terminos', '/sorteos/', '/sorteos/organizador']) {
    test(ruta, async () => {
      const { ctx, page, reg } = await nuevaPagina(nav, sitio);
      try {
        const r = await page.goto(sitio.url + ruta, { waitUntil: 'load' });
        assert.equal(r.status(), 200);
        await page.waitForTimeout(800);
        assert.deepEqual(reg.errores, []);
        assert.deepEqual(reg.csp.filter((c) => !/internetdisconnected/.test(c)), []);
      } finally { await ctx.close(); }
    });
  }
});
