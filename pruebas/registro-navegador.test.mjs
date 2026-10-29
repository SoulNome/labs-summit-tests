// El registro en vivo en un navegador: la página del QR (/participa) en un celular, la pantalla con el QR,
// y la herramienta del organizador trayendo los registros y publicando el sorteo en labssummit.com/sorteos.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarSitio, CLAVE_PRUEBA } from './_sitio.mjs';
import { chromium, nuevaPagina, simularDrand, jsonCors } from './_navegador.mjs';
import { cargarNucleos, sorteoDePrueba, WALKTHROUGH, RONDA_38 } from './_datos.mjs';

let sitio, sinBase, nav, NP;
before(async () => {
  ({ NP } = cargarNucleos());
  [sitio, sinBase] = await Promise.all([iniciarSitio({ registro: true }), iniciarSitio()]);
  nav = await chromium.launch();
});
after(async () => { await nav?.close(); await sitio?.cerrar(); await sinBase?.cerrar(); });

const PRUEBA = { red: WALKTHROUGH };
const CELULAR = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function enCelular(base = sitio) {
  const x = await nuevaPagina(nav, base, { prueba: PRUEBA });
  await x.page.setViewportSize(CELULAR.viewport);
  return x;
}
async function api(ruta, cuerpo) {
  const r = await fetch(sitio.url + ruta, cuerpo === undefined ? { headers: { Authorization: 'Bearer ' + CLAVE_PRUEBA } }
    : { method: 'POST', headers: { Authorization: 'Bearer ' + CLAVE_PRUEBA, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  return r.json();
}

describe('página del QR (/participa)', () => {
  test('registro completo desde el celular, sin HTML inyectado ni violaciones de CSP', async () => {
    const { ctx, page, reg } = await enCelular();
    try {
      await page.goto(sitio.url + '/participa');
      assert.equal(await page.isVisible('#p-form'), true);
      // sin datos: dice qué falta en cada campo
      await page.click('#p-enviar');
      for (const c of ['nombre', 'celular', 'autoriza']) assert.equal(await page.isVisible('#p-' + c + '-error'), true, c);
      assert.equal(await page.getAttribute('#p-nombre', 'aria-invalid'), 'true');
      await page.fill('#p-nombre', 'Ana <b onmouseover=alert(1)>María</b> Pérez');
      await page.fill('#p-celular', '+57 310 555 0001');
      await page.check('#p-autoriza');
      await page.click('#p-enviar');
      await page.waitForSelector('#p-listo:not([hidden])');
      assert.match(await page.textContent('#p-etiqueta'), /^Ana .*· …0001$/);
      assert.equal(await page.$$eval('#p-etiqueta *', (xs) => xs.length), 0, 'la etiqueta es solo texto');
      assert.equal(await page.isHidden('#p-form'), true);
      assert.match(await page.textContent('#p-contador'), /1 persona ya participa/);
      // al volver a abrir la página en el mismo celular, recuerda el registro
      await page.reload();
      await page.waitForSelector('#p-listo:not([hidden])');
      assert.match(await page.textContent('#p-listo-ya'), /Ya te registraste/);
      await page.click('#p-otra');
      assert.equal(await page.isVisible('#p-form'), true);
      assert.equal(await page.inputValue('#p-nombre'), '');
      assert.deepEqual(reg.errores, []);
      assert.deepEqual(reg.csp, []);
      assert.deepEqual(reg.dialogos, []);
      const registro = (await api('/api/registros')).registros.find((x) => x.celular === '3105550001');
      assert.ok(registro, 'quedó registrado');
      assert.doesNotMatch(registro.nombre, /[<>]/);
    } finally { await ctx.close(); }
  });

  test('un celular ya registrado avisa y muestra el nombre con que quedó', async () => {
    await api('/api/registros', { accion: 'abrir' });
    const { ctx, page } = await enCelular();
    try {
      await page.goto(sitio.url + '/participa');
      await page.fill('#p-nombre', 'Otro Nombre Distinto');
      await page.fill('#p-celular', '310 555 0001');
      await page.check('#p-autoriza');
      await page.click('#p-enviar');
      await page.waitForSelector('#p-listo:not([hidden])');
      assert.match(await page.textContent('#p-listo-ya'), /ya estaba registrado/);
      assert.match(await page.textContent('#p-etiqueta'), /^Ana .*· …0001$/);
    } finally { await ctx.close(); }
  });

  test('si se cae la conexión, los datos siguen escritos y se puede reintentar', async () => {
    const { ctx, page } = await enCelular();
    try {
      await page.goto(sitio.url + '/participa');
      await page.route('**/api/participa', (r) => (r.request().method() === 'POST' ? r.abort('internetdisconnected') : r.continue()));
      await page.fill('#p-nombre', 'Sin Señal Pérez');
      await page.fill('#p-celular', '3005550002');
      await page.check('#p-autoriza');
      await page.click('#p-enviar');
      await page.waitForSelector('#p-error:not([hidden])');
      assert.match(await page.textContent('#p-error'), /No pudimos conectarnos/);
      assert.equal(await page.inputValue('#p-nombre'), 'Sin Señal Pérez');
      assert.equal(await page.isEnabled('#p-enviar'), true);
      await page.unroute('**/api/participa');
      await page.click('#p-enviar');
      await page.waitForSelector('#p-listo:not([hidden])');
    } finally { await ctx.close(); }
  });

  test('con el registro cerrado no deja inscribirse', async () => {
    await api('/api/registros', { accion: 'cerrar' });
    const { ctx, page } = await enCelular();
    try {
      await page.goto(sitio.url + '/participa');
      await page.waitForSelector('#p-cerrado:not([hidden])');
      assert.equal(await page.isHidden('#p-form'), true);
    } finally {
      await ctx.close();
      await api('/api/registros', { accion: 'abrir' });
    }
  });

  test('antes de configurar Cloudflare avisa que el registro abre pronto', async () => {
    const { ctx, page, reg } = await enCelular(sinBase);
    try {
      await page.goto(sinBase.url + '/participa');
      await page.waitForSelector('#p-pronto:not([hidden])');
      assert.equal(await page.isHidden('#p-form'), true);
      assert.deepEqual(reg.errores, []);
    } finally { await ctx.close(); }
  });

  test('pantalla para proyectar: QR grande y cuántos participan', async () => {
    const { ctx, page, reg } = await nuevaPagina(nav, sitio);
    try {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(sitio.url + '/participa?pantalla');
      await page.waitForSelector('#pp-cuenta:not([hidden])');
      assert.equal(await page.isHidden('#p-form'), true);
      assert.ok(Number((await page.textContent('#pp-total')).replace(/\D/g, '')) >= 2);
      const qr = await page.$eval('.pp-qr img', (img) => ({ ok: img.complete && img.naturalWidth > 0, ancho: img.getBoundingClientRect().width }));
      assert.equal(qr.ok, true);
      assert.ok(qr.ancho > 400, 'el QR se ve grande: ' + qr.ancho);
      assert.deepEqual(reg.csp, []);
    } finally { await ctx.close(); }
  });
});

describe('organizador con los registros del QR', () => {
  test('trae los registros, cierra la lista y el sorteo queda publicado al instante', async () => {
    await api('/api/registros', { accion: 'vaciar', confirmar: 'VACIAR' });
    const personas = [['Laura Sánchez Gómez', '3001110001'], ['Julián Lago', '+57 300 111 0002'], ['Camila Rodríguez', '3001110003'], ['Mateo Costa', '3001110004']];
    for (const [nombre, celular] of personas) {
      await fetch(sitio.url + '/api/participa', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.50.0.' + celular.slice(-1) }, body: JSON.stringify({ nombre, celular, autoriza: true }) });
    }
    const { ctx, page, reg } = await nuevaPagina(nav, sitio, { prueba: PRUEBA });
    try {
      await page.goto(sitio.url + '/sorteos/organizador');
      await page.waitForFunction(() => /Registro abierto · 4 personas/.test(document.getElementById('o-qr-estado').textContent));
      // clave equivocada
      await page.fill('#o-clave', 'no-es-la-clave');
      await page.click('#o-traer');
      await page.waitForFunction(() => /Clave incorrecta/.test(document.getElementById('o-qr-msg').textContent));
      assert.equal(await page.isHidden('#paso2'), true);
      // clave buena
      await page.fill('#o-clave', CLAVE_PRUEBA);
      await page.click('#o-traer');
      await page.waitForSelector('#paso2:not([hidden])');
      assert.match(await page.textContent('#o-qr-msg'), /4 registros traídos/);
      assert.equal(await page.$eval('#o-col-id', (s) => s.options[s.selectedIndex].text), 'Celular');
      assert.equal(await page.$eval('#o-col-nombre', (s) => s.options[s.selectedIndex].text), 'Nombre completo');
      assert.match(await page.textContent('#o-avisos'), /4 personas registradas participan/);
      assert.match(await page.textContent('#o-muestra'), /Laura S\. G\. · …0001/);
      // datos del sorteo y generar
      await page.fill('#o-titulo', 'Sorteo del celular');
      await page.fill('#o-premios', 'Celular\nSuplente 1');
      await page.click('#o-rapido [data-min="5"]');
      await page.click('#o-generar');
      await page.waitForFunction(() => /Publicado en labssummit\.com\/sorteos/.test(document.getElementById('o-publicado').textContent));
      assert.equal(await page.isVisible('#o-enlace-pantalla'), true);
      const id = await page.$eval('#o-enlace-pantalla', (a) => new URL(a.href).searchParams.get('id'));
      // lo publicado es el archivo público: sin celulares ni nombres completos
      const publicado = await (await fetch(sitio.url + '/api/sorteos?id=' + id)).text();
      assert.match(publicado, /Laura S\. G\. · …0001/);
      for (const [nombre, celular] of personas) {
        assert.ok(!publicado.includes(nombre), 'sin nombre completo: ' + nombre);
        assert.ok(!publicado.includes(celular.replace(/\D/g, '').slice(-10)), 'sin celular: ' + celular);
      }
      // la clave queda solo en esta pestaña (no se marcó «Recordarla»)
      assert.equal(await page.evaluate(() => localStorage.getItem('lsSorteoClave')), null);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('lsSorteoClave')), CLAVE_PRUEBA);
      assert.deepEqual(reg.errores, []);
      assert.deepEqual(reg.csp, []);

      // cualquiera lo ve en labssummit.com/sorteos desde ya
      const pub = await nuevaPagina(nav, sitio, { prueba: PRUEBA });
      try {
        await pub.page.goto(sitio.url + '/sorteos/');
        await pub.page.waitForSelector('.tarjeta');
        assert.match(await pub.page.textContent('.tarjeta'), /Sorteo del celular/);
        assert.match(await pub.page.textContent('.tarjeta'), /Próximo/);
        await pub.page.click('.tarjeta');
        await pub.page.waitForSelector('.sv-cuenta-num');
        assert.match(await pub.page.textContent('.sv-datos'), /publicada [4-7] minutos antes del sorteo/);
        assert.match(await pub.page.textContent('.sv-cab'), /\+ 1 suplente/);
        await pub.page.fill('#sv-buscar', 'julian');
        await pub.page.waitForSelector('.sv-resultados li');
        assert.match(await pub.page.textContent('.sv-resultados'), /Julián L\. · …0002/);
        assert.deepEqual(pub.reg.csp, []);
      } finally { await pub.ctx.close(); }

      // si la página del organizador se recarga, el último sorteo sigue a mano
      await page.reload();
      await page.waitForSelector('#paso4:not([hidden])');
      assert.match(await page.textContent('#o-estado-ganadores'), /deja esta página abierta/);
    } finally { await ctx.close(); }
  });

  test('vaciar los registros de prueba pide escribir VACIAR', async () => {
    const { ctx, page } = await nuevaPagina(nav, sitio, { prueba: PRUEBA });
    try {
      await page.goto(sitio.url + '/sorteos/organizador');
      await page.fill('#o-clave', CLAVE_PRUEBA);
      await page.click('.mas summary');
      page.removeAllListeners('dialog');
      page.once('dialog', (d) => d.accept('no'));
      await page.click('#o-vaciar');
      await page.waitForFunction(() => /No se borró nada/.test(document.getElementById('o-qr-msg').textContent));
      assert.equal((await api('/api/registros')).total, 4);
      page.once('dialog', (d) => d.accept('VACIAR'));
      await page.click('#o-vaciar');
      await page.waitForFunction(() => /Se borraron todos/.test(document.getElementById('o-qr-msg').textContent));
      assert.equal((await api('/api/registros')).total, 0);
      assert.match(await page.textContent('#o-qr-estado'), /0 personas registradas/);
    } finally { await ctx.close(); }
  });
});

describe('pantalla del sorteo', () => {
  test('revela al ganador con confeti, muestra los suplentes aparte y el QR para registrarse', async () => {
    // una copia de la cadena de prueba en la que la ronda 38 sale en 6 segundos: así la pantalla llega antes del sorteo
    const red = { ...WALKTHROUGH, genesis: Math.floor(Date.now() / 1000) - 37 * 3 + 6 };
    const { pub } = await sorteoDePrueba(NP, { n: 20, premios: ['Celular', 'Suplente 1', 'Suplente 2'], id: '2026-10-29-1800-pantalla' });
    const esperado = await NP.verificar(pub, NP.comprobarRonda(RONDA_38, 38));
    const { ctx, page, reg } = await nuevaPagina(nav, sitio, { prueba: { red } });
    try {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.route('**/api/sorteos?id=' + pub.id, (r) => r.fulfill(jsonCors(pub)));
      await simularDrand(page, (r) => r.fulfill(jsonCors(RONDA_38)));
      await page.goto(sitio.url + '/sorteos/?id=' + pub.id + '&pantalla');
      await page.waitForSelector('.sv-cuenta-num');
      assert.equal(await page.isVisible('.sv-qr img'), true);
      assert.match(await page.textContent('.sv-qr'), /Escanea para los próximos sorteos/);
      assert.match(await page.textContent('.sv-cab'), /\+ 2 suplentes/);
      await page.waitForSelector('.confeti', { timeout: 20000 });
      assert.equal(await page.textContent('.sv-ganador .et'), esperado.ganadores[0].etiqueta);
      assert.equal(await page.$$eval('.sv-ganador', (xs) => xs.length), 1, 'en grande solo el premio');
      await page.waitForSelector('.sv-suplentes-caja:not([hidden])');
      assert.deepEqual(await page.$$eval('.sv-suplente .et', (xs) => xs.map((x) => x.textContent)), esperado.ganadores.slice(1).map((g) => g.etiqueta));
      assert.deepEqual(reg.errores, []);
      assert.deepEqual(reg.csp, []);
    } finally { await ctx.close(); }
  });
});
