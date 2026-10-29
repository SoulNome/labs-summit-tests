// Resistencia a caídas: servicios de terceros caídos, servidores de drand fuera de línea y el mapa sin señal.
// (No hacemos pruebas de carga contra producción: el sitio es estático en la red de Cloudflare y
// bombardearlo durante el evento solo serviría para molestar a los asistentes.)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarSitio } from './_sitio.mjs';
import { chromium, nuevaPagina, simularDrand, jsonCors } from './_navegador.mjs';
import { cargarNucleos, sorteoDePrueba, WALKTHROUGH, RONDA_38 } from './_datos.mjs';

let sitio, nav, NP;
before(async () => { ({ NP } = cargarNucleos()); sitio = await iniciarSitio(); nav = await chromium.launch(); });
after(async () => { await nav?.close(); await sitio?.cerrar(); });

describe('si se caen Google Fonts, Clarity, Meta, el bucket R2 y Google Maps, el sitio sigue funcionando', () => {
  const casos = {
    '/': async (page) => {
      assert.match(await page.textContent('#hero'), /LABS/);
      assert.ok(await page.isVisible('#tickets'));
      assert.match(await page.textContent('#tickets'), /\$/);
      assert.ok(await page.isVisible('a[href^="https://coccoa.xyz/"]'), 'los botones de compra siguen ahí');
    },
    '/speakers': async (page) => { assert.ok((await page.$$('[data-abrir]')).length > 5, 'muestra las fichas de los speakers'); },
    '/mapa/?lista': async (page) => { assert.match(await page.textContent('body'), /Caja de Arena/); },
    '/sorteos/': async (page) => { assert.match(await page.textContent('#lista-sorteos'), /sorteos/i); }
  };
  for (const [ruta, revisar] of Object.entries(casos)) {
    test(ruta, async () => {
      const { ctx, page, reg } = await nuevaPagina(nav, sitio);   // todo lo externo se corta
      try {
        const r = await page.goto(sitio.url + ruta, { waitUntil: 'load', timeout: 30000 });
        assert.equal(r.status(), 200);
        await page.waitForTimeout(1000);
        await revisar(page);
        assert.deepEqual(reg.errores, [], 'sin errores de JavaScript');
      } finally { await ctx.close(); }
    });
  }
});

describe('sorteo con drand caído', () => {
  test('si fallan los primeros servidores de drand, usa el siguiente', async () => {
    const { pub } = await sorteoDePrueba(NP, { n: 20 });
    const prueba = { red: WALKTHROUGH, relevos: ['https://api.drand.sh', 'https://api2.drand.sh', 'https://api3.drand.sh', 'https://drand.cloudflare.com'] };
    const { ctx, page } = await nuevaPagina(nav, sitio, { prueba });
    try {
      await page.route('**/sorteos/datos/' + pub.id + '.json', (r) => r.fulfill(jsonCors(pub)));
      const usados = [];
      await simularDrand(page, (r) => {
        usados.push(new URL(r.request().url()).host);
        return /cloudflare/.test(r.request().url()) ? r.fulfill(jsonCors(RONDA_38)) : r.abort('connectionrefused');
      });
      await page.goto(sitio.url + '/sorteos/?id=' + pub.id);
      await page.waitForSelector('.sv-ganador');
      assert.deepEqual(usados, ['api.drand.sh', 'api2.drand.sh', 'api3.drand.sh', 'drand.cloudflare.com']);
    } finally { await ctx.close(); }
  });

  test('sin conexión avisa y, cuando vuelve la señal, el resultado aparece solo (y es el mismo)', async () => {
    const { pub } = await sorteoDePrueba(NP, { n: 20 });
    const esperado = await NP.verificar(pub, NP.comprobarRonda(RONDA_38, 38));
    const { ctx, page } = await nuevaPagina(nav, sitio, { prueba: { red: WALKTHROUGH } });
    try {
      await page.route('**/sorteos/datos/' + pub.id + '.json', (r) => r.fulfill(jsonCors(pub)));
      let hayRed = false;
      await simularDrand(page, (r) => (hayRed ? r.fulfill(jsonCors(RONDA_38)) : r.abort('internetdisconnected')));
      await page.goto(sitio.url + '/sorteos/?id=' + pub.id);
      await page.waitForFunction(() => /Sin conexión con drand/.test(document.querySelector('.sv-estado')?.textContent || ''));
      assert.equal(await page.$$eval('.sv-ganador', (xs) => xs.length), 0);
      hayRed = true;   // vuelve el internet
      await page.waitForSelector('.sv-ganador', { timeout: 15000 });
      assert.deepEqual(await page.$$eval('.sv-ganador .et', (xs) => xs.map((x) => x.textContent)), esperado.ganadores.map((g) => g.etiqueta));
    } finally { await ctx.close(); }
  });
});

describe('mapa sin señal en el Coliseo', () => {
  test('después de abrirlo una vez, el mapa carga sin internet (service worker)', async () => {
    const local = { url: sitio.url.replace('127.0.0.1', 'localhost') };   // el service worker solo se registra en https o localhost
    if (sitio.remoto) local.url = sitio.url;
    const { ctx, page, reg } = await nuevaPagina(nav, local, { serviceWorkers: 'allow' });
    try {
      await page.goto(local.url + '/mapa/?lista', { waitUntil: 'load' });
      await page.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((_, mal) => setTimeout(() => mal(new Error('el service worker no se activó')), 20000))]));
      await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('mapa-')) && (await (await caches.open((await caches.keys()).find((k) => k.startsWith('mapa-')))).keys()).length >= 9, null, { timeout: 30000 });
      await ctx.setOffline(true);
      await page.reload({ waitUntil: 'load' });
      assert.match(await page.title(), /Mapa del evento/);
      assert.match(await page.textContent('body'), /Caja de Arena/);
      assert.deepEqual(reg.errores, []);
    } finally { await ctx.close(); }
  });
});
