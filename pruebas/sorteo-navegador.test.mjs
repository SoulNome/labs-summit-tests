// El sorteo completo en un navegador: herramienta del organizador, página pública, pantalla grande,
// archivo manipulado, relevo de drand que miente y revelación del ganador.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { iniciarSitio } from './_sitio.mjs';
import { chromium, nuevaPagina, simularDrand, jsonCors } from './_navegador.mjs';
import { cargarNucleos, sorteoDePrueba, clonar, WALKTHROUGH, RONDA_38 } from './_datos.mjs';
import { excelCoccoaFalso, crearXlsx } from './_xlsx.mjs';

let sitio, nav, N, NP;
before(async () => { ({ N, NP } = cargarNucleos()); sitio = await iniciarSitio(); nav = await chromium.launch(); });
after(async () => { await nav?.close(); await sitio?.cerrar(); });

const PRUEBA = { red: WALKTHROUGH };   // la página usa la cadena de prueba (tiene una ronda real firmada)
const horaLocal = (ms) => new Date(ms - 5 * 3600e3).toISOString().slice(0, 16);

/** Sirve un sorteo de prueba en /sorteos/datos/ sin tocar el disco. */
async function publicar(page, pub, extra = {}) {
  await page.route('**/sorteos/datos/indice.json', (r) => r.fulfill(jsonCors({ formato: 'labs-summit-sorteo/v1', sorteos: [{ id: pub.id, titulo: pub.titulo, ensayo: pub.ensayo, ronda: pub.azar.ronda, participantes: pub.participantes.length, huella: pub.huella }] })));
  await page.route('**/sorteos/datos/' + pub.id + '.json', (r) => r.fulfill(jsonCors({ ...pub, ...extra })));
}

describe('herramienta del organizador', () => {
  test('CSV de Excel (Windows-1252, «;»): filtra pendientes, quita duplicados, genera archivos sin datos personales', async () => {
    const csv = [
      'Nombre;Cédula;Código boleta;Cantidad;Estado',
      'María José Echeverri;1.116.234.567;LS-20669-0001;1;Aprobado',
      'JUAN PABLO DE LA CRUZ;94.555.111;LS-20669-0002;2;Aprobado',
      'Ana Gómez;1.112.000.333;LS-20669-0003;1;Pendiente',
      'Luis Peña;1.113.444.555;LS-20669-0001;1;Aprobado',
      'Sin Código;1.000.000.000;;1;Aprobado',
      'Valentina Ríos;1.114.666.777;LS-20669-0004;1;Aprobado'
    ].join('\r\n');
    const { ctx, page, reg } = await nuevaPagina(nav, sitio);
    try {
      await page.goto(sitio.url + '/sorteos/organizador');
      await page.setInputFiles('#o-archivo', { name: 'ventas-coccoa.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'latin1') });
      await page.waitForSelector('#paso2:not([hidden])');
      assert.match(await page.textContent('#o-leido'), /6 filas con 5 columnas/);
      // columnas adivinadas por el título
      assert.equal(await page.$eval('#o-col-id', (s) => s.options[s.selectedIndex].text), 'Código boleta');
      assert.equal(await page.$eval('#o-col-nombre', (s) => s.options[s.selectedIndex].text), 'Nombre');
      assert.equal(await page.$eval('#o-col-cantidad', (s) => s.options[s.selectedIndex].text), 'Cantidad');
      assert.ok((await page.$$eval('#o-grupos legend', (xs) => xs.map((x) => x.textContent))).includes('Estado'));
      assert.equal(await page.isChecked('#o-grupos input[value="Aprobado"]'), true);
      assert.equal(await page.isChecked('#o-grupos input[value="Pendiente"]'), false, 'los pagos pendientes no participan');
      assert.match(await page.textContent('#o-muestra'), /María J\. E\. · …0001/);

      await page.fill('#o-titulo', 'Sorteo de cierre');
      await page.fill('#o-premios', 'Bono de $500.000\nKit Labs Summit');
      await page.fill('#o-hora', horaLocal(Date.now() + 10 * 60e3));
      await page.click('#o-generar');
      await page.waitForSelector('#paso4:not([hidden])');
      const resumen = await page.textContent('#o-resumen');
      assert.match(resumen, /4 participaciones/);
      assert.match(resumen, /1 filas quedaron fuera por el filtro/);
      assert.match(resumen, /1 filas sin identificador/);
      assert.match(resumen, /1 repetidas/);

      const bajar = async (boton) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(boton)]); return { nombre: d.suggestedFilename(), texto: readFileSync(await d.path(), 'utf8') }; };
      const pub = await bajar('#o-bajar-publico');
      const priv = await bajar('#o-bajar-privado');
      const ind = await bajar('#o-bajar-indice');

      const s = JSON.parse(pub.texto);
      assert.match(pub.nombre, /^\d{4}-\d{2}-\d{2}-\d{4}-sorteo-de-cierre\.json$/);
      assert.deepEqual(N.validar(s), []);
      assert.equal(await N.huellaDe(s), s.huella, 'la huella del archivo es la del acta');
      assert.match(resumen, new RegExp(s.huella));
      assert.deepEqual(s.participantes.map((p) => p[0]), ['María J. E. · …0001', 'Juan P. C. · …0002 · 1/2', 'Juan P. C. · …0002 · 2/2', 'Valentina R. · …0004']);
      assert.deepEqual(s.premios, ['Bono de $500.000', 'Kit Labs Summit']);
      for (const dato of ['Echeverri', '1116234567', '1.116.234.567', 'LS-20669', 'Ríos', 'Pendiente', 'Gómez']) {
        assert.ok(!pub.texto.includes(dato), 'el archivo público no tiene «' + dato + '»');
      }
      const p = JSON.parse(priv.texto);
      assert.match(priv.nombre, /\.privado\.json$/);
      assert.equal(p.huella, s.huella);
      assert.ok(p.participantes.every((x) => /^[0-9a-f]{32}$/.test(x.sal)));
      assert.ok(priv.texto.includes('1.116.234.567'), 'el privado sí guarda la fila completa para contactar');
      const indice = JSON.parse(ind.texto);
      assert.equal(indice.sorteos.at(-1).id, s.id);
      assert.equal(indice.sorteos.at(-1).huella, s.huella);
      assert.deepEqual(reg.errores, []);
    } finally { await ctx.close(); }
  });

  test('el Excel de Coccoa tal cual: código del enlace, celular, filtros y avisos', async () => {
    const { buffer, codigos, personas } = excelCoccoaFalso({ n: 30 });
    const { ctx, page, reg } = await nuevaPagina(nav, sitio);
    try {
      await page.goto(sitio.url + '/sorteos/organizador');
      await page.setInputFiles('#o-archivo', { name: 'Labs_Summit_.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
      await page.waitForSelector('#paso2:not([hidden])');
      assert.match(await page.textContent('#o-leido'), /30 filas/);
      const elegida = (sel) => page.$eval(sel, (s) => s.options[s.selectedIndex].text);
      assert.equal(await elegida('#o-col-id'), 'Código del enlace (Visualizar código)');
      assert.equal(await elegida('#o-col-nombre'), 'Nombre');
      assert.equal(await elegida('#o-col-visible'), 'Tel.');
      const grupos = await page.$$eval('#o-grupos legend', (xs) => xs.map((x) => x.textContent));
      for (const g of ['Tipo', 'Etapa', 'Metodo de pago', 'Promotor']) assert.ok(grupos.includes(g), 'filtro por ' + g);
      for (const g of ['Visualizar código', 'Reenviar', 'Precio', 'Id Pago', 'Valido', 'Dia vendido', 'Nombre', 'Correo']) assert.ok(!grupos.includes(g), 'sin filtro por ' + g);
      const avisos = await page.textContent('#o-avisos');
      assert.match(avisos, /30 de 30 filas participan/);
      assert.match(avisos, /registros desde 2026-10-28/);
      assert.match(avisos, /código del enlace/);
      assert.match(avisos, /27 de las que participan son de cortesía/);
      assert.match(await page.textContent('#o-muestra'), /María J\. E\. · …1000/);
      // con el correo como identificador se juntarían personas distintas: la herramienta lo advierte
      await page.selectOption('#o-col-id', { label: 'Correo' });
      assert.match(await page.textContent('#o-avisos'), /se repite.*nombres distintos/);
      await page.selectOption('#o-col-id', { label: 'Código del enlace (Visualizar código)' });
      // solo las compradas
      await page.uncheck('#o-grupos input[value="Cortesia"]');
      assert.match(await page.textContent('#o-avisos'), /3 de 30 filas participan/);
      await page.check('#o-grupos input[value="Cortesia"]');

      await page.fill('#o-titulo', 'Sorteo Día 2');
      await page.fill('#o-premios', 'Bono');
      await page.fill('#o-hora', horaLocal(Date.now() + 10 * 60e3));
      await page.click('#o-generar');
      await page.waitForSelector('#paso4:not([hidden])');
      assert.match(await page.textContent('#o-resumen'), /30 participaciones/);
      const [d1] = await Promise.all([page.waitForEvent('download'), page.click('#o-bajar-publico')]);
      const texto = readFileSync(await d1.path(), 'utf8'), s = JSON.parse(texto);
      assert.equal(s.participantes.length, 30, 'cada boleta cuenta, aunque compartan correo o celular');
      assert.equal(s.participantes[0][0], 'María J. E. · …1000');
      for (const p of personas) {
        assert.ok(!texto.includes(p.correo), 'sin correos');
        assert.ok(!texto.includes(p.codigo), 'sin el código del enlace');
        assert.ok(!texto.includes(p.tel) && !texto.includes(p.tel.replace(/\D/g, '')), 'sin celulares');
      }
      const [d2] = await Promise.all([page.waitForEvent('download'), page.click('#o-bajar-privado')]);
      const priv = JSON.parse(readFileSync(await d2.path(), 'utf8'));
      assert.equal(priv.revelable, false, 'el código del enlace nunca se revela');
      assert.deepEqual(priv.participantes.map((x) => x.idOriginal), codigos);
      assert.deepEqual(reg.errores, []);
    } finally { await ctx.close(); }
  });

  test('registros del QR (Google Forms): cada celular participa una vez aunque se registre varias veces', async () => {
    const filas = [['Marca temporal', 'Nombre completo', 'Celular', 'Autorizo el tratamiento de mis datos personales']], extra = {};
    const gente = [['ana gómez', '+57 300 123 4567'], ['Luis Peña', '3011112222'], ['Ana Gómez', '3001234567'],   // Ana se registró dos veces
      ['MARÍA JOSÉ RÍOS', '(302) 333-4444'], ['Carlos Ruiz', '573045556666'], ['Sofía Castro', '305 777 8888']];
    gente.forEach(([nombre, cel], i) => {
      filas.push(['', nombre, cel, 'Sí, autorizo']);
      extra['A' + (i + 2)] = `<c r="A${i + 2}" s="1"><v>${(46324.68 + i * 0.001).toFixed(6)}</v></c>`;   // así guarda Google la «Marca temporal»
    });
    const buffer = crearXlsx(filas, { compartidas: true, comprimir: true, celdasExtra: extra, hoja: 'Respuestas de formulario 1' });
    const { ctx, page, reg } = await nuevaPagina(nav, sitio);
    try {
      await page.goto(sitio.url + '/sorteos/organizador');
      await page.setInputFiles('#o-archivo', { name: 'Sorteo Labs Summit (respuestas).xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
      await page.waitForSelector('#paso2:not([hidden])');
      const elegida = (sel) => page.$eval(sel, (x) => x.options[x.selectedIndex].text);
      assert.equal(await elegida('#o-col-id'), 'Celular');
      assert.equal(await elegida('#o-col-nombre'), 'Nombre completo');
      assert.equal(await elegida('#o-col-visible'), '— el identificador —');
      assert.equal(await page.isHidden('#o-filtros'), true, 'no hay nada que filtrar');
      assert.match(await page.textContent('#o-avisos'), /registros desde 2026-10-29 16:19/);
      assert.match(await page.textContent('#o-muestra'), /Ana G\. · …4567/);
      await page.fill('#o-titulo', 'Gran sorteo en vivo');
      await page.fill('#o-premios', 'Reloj\nHospedaje\nTablet\nCelular');
      await page.fill('#o-hora', horaLocal(Date.now() + 10 * 60e3));
      await page.click('#o-generar');
      await page.waitForSelector('#paso4:not([hidden])');
      const resumen = await page.textContent('#o-resumen');
      assert.match(resumen, /5 participaciones/);
      assert.match(resumen, /1 repetidas/);
      const [d] = await Promise.all([page.waitForEvent('download'), page.click('#o-bajar-publico')]);
      const texto = readFileSync(await d.path(), 'utf8'), s = JSON.parse(texto);
      assert.deepEqual(s.participantes.map((p) => p[0]), ['Ana G. · …4567', 'Luis P. · …2222', 'María J. R. · …4444', 'Carlos R. · …6666', 'Sofía C. · …8888']);
      assert.deepEqual(s.premios, ['Reloj', 'Hospedaje', 'Tablet', 'Celular']);
      for (const [, cel] of gente) assert.ok(!texto.includes(cel.replace(/\D/g, '').slice(-10)), 'sin celulares completos');
      assert.deepEqual(reg.errores, []);
    } finally { await ctx.close(); }
  });

  test('no deja cerrar un sorteo oficial con la hora ya pasada (se podría conocer el azar)', async () => {
    const { ctx, page } = await nuevaPagina(nav, sitio);
    try {
      await page.goto(sitio.url + '/sorteos/organizador');
      await page.fill('#o-pegar', 'Nombre\tCódigo\nAna\tA1\nLuis\tB2');
      await page.click('#o-leer');
      await page.fill('#o-titulo', 'Sorteo tramposo');
      await page.fill('#o-premios', 'Bono');
      await page.fill('#o-hora', horaLocal(Date.now() - 5 * 60e3));
      await page.click('#o-generar');
      await page.waitForSelector('#o-error:not([hidden])');
      assert.match(await page.textContent('#o-error'), /al menos 3 minutos/);
      assert.equal(await page.isHidden('#paso4'), true);
      await page.check('#o-ensayo');
      await page.click('#o-generar');
      await page.waitForSelector('#paso4:not([hidden])');
      assert.match(await page.textContent('#o-resumen'), /Ensayo/);
    } finally { await ctx.close(); }
  });

  test('después del sorteo muestra los datos de contacto del ganador y genera la revelación', async () => {
    const { pub, prep } = await sorteoDePrueba(NP, { n: 12 });
    const privado = { formato: 'labs-summit-sorteo/v1-privado', id: pub.id, huella: pub.huella, columnas: ['Nombre', 'Código', 'Estado'],
      participantes: prep.participantes.map((x) => ({ posicion: x.posicion, etiqueta: x.etiqueta, id: x.id, idOriginal: x.idOriginal, nombre: x.nombre, sal: x.sal, fila: x.fila })) };
    const esperado = await NP.verificar(pub, NP.comprobarRonda(RONDA_38, 38));
    const { ctx, page } = await nuevaPagina(nav, sitio, { prueba: PRUEBA });
    try {
      await simularDrand(page, (r) => r.fulfill(jsonCors(RONDA_38)));
      await page.goto(sitio.url + '/sorteos/organizador');
      await page.setInputFiles('#o-publico', { name: pub.id + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pub)) });
      await page.setInputFiles('#o-privado', { name: pub.id + '.privado.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(privado)) });
      await page.waitForSelector('.tarjeta-ganador');
      const tarjetas = await page.$$eval('.tarjeta-ganador', (xs) => xs.map((x) => x.textContent));
      assert.equal(tarjetas.length, 2);
      esperado.ganadores.forEach((g, i) => {
        assert.match(tarjetas[i], new RegExp('n\\.º ' + g.posicion + '\\b'));
        assert.match(tarjetas[i], /Coincide con el compromiso publicado/);
        assert.ok(tarjetas[i].includes(prep.participantes[g.posicion - 1].idOriginal), 'muestra el código completo para contactarlo');
      });
      const [d] = await Promise.all([page.waitForEvent('download'), page.click('text=Descargar archivo público con la revelación')]);
      const conRev = JSON.parse(readFileSync(await d.path(), 'utf8'));
      assert.equal(conRev.huella, pub.huella, 'la revelación no cambia la huella');
      assert.equal(conRev.revelaciones.length, 2);
      for (const rv of conRev.revelaciones) assert.equal(await NP.comprobarRevelacion(pub, rv), true);
    } finally { await ctx.close(); }
  });
});

describe('página pública', () => {
  test('muestra el sorteo, verifica la firma de drand y da los mismos ganadores que el cálculo independiente', async () => {
    const { pub } = await sorteoDePrueba(NP, { n: 40 });
    const esperado = await NP.verificar(pub, NP.comprobarRonda(RONDA_38, 38));
    const { ctx, page, reg } = await nuevaPagina(nav, sitio, { prueba: PRUEBA });
    try {
      await publicar(page, pub);
      await simularDrand(page, (r) => r.fulfill(jsonCors(RONDA_38)));
      await page.goto(sitio.url + '/sorteos/');
      await page.waitForSelector('.tarjeta');
      assert.match(await page.textContent('.tarjeta'), /Sorteo de prueba/);
      await page.click('.tarjeta');
      await page.waitForSelector('.sv-ganador');
      const ganadores = await page.$$eval('.sv-ganador .et', (xs) => xs.map((x) => x.textContent));
      assert.deepEqual(ganadores, esperado.ganadores.map((g) => g.etiqueta));
      assert.match(await page.textContent('.sv-huella-ok'), /coincide/);
      assert.equal(await page.$$eval('.pasos .visto.si', (xs) => xs.length), 3, 'los tres pasos verificados');
      assert.match(await page.textContent('.sv-verif'), new RegExp(RONDA_38.randomness));
      // ¿Estoy participando?
      await page.fill('#sv-buscar', '1007');
      await page.waitForSelector('.sv-resultados li');
      assert.match(await page.textContent('.sv-resultados'), /n\.º 8 .*…1007/);
      await page.fill('#sv-buscar', 'nadie-se-llama-asi');
      assert.match(await page.textContent('.sv-resultados'), /No encontramos/);
      assert.deepEqual(reg.errores, []);
      assert.deepEqual(reg.csp, []);
    } finally { await ctx.close(); }
  });

  test('pantalla grande del evento', async () => {
    const { pub } = await sorteoDePrueba(NP, { n: 15, premios: ['Gran premio'] });
    const esperado = await NP.verificar(pub, NP.comprobarRonda(RONDA_38, 38));
    const { ctx, page } = await nuevaPagina(nav, sitio, { prueba: PRUEBA });
    try {
      await publicar(page, pub);
      await simularDrand(page, (r) => r.fulfill(jsonCors(RONDA_38)));
      await page.goto(sitio.url + '/sorteos/?id=' + pub.id + '&pantalla');
      await page.waitForSelector('.sv-ganador.listo, .sv-ganador:not(.girando)');
      assert.equal(await page.evaluate(() => document.body.classList.contains('modo-pantalla')), true);
      assert.equal(await page.isHidden('.barra'), true);
      assert.equal(await page.textContent('.sv-ganador .et'), esperado.ganadores[0].etiqueta);
      assert.match(await page.textContent('.sv-pie-pantalla'), /labssummit\.com\/sorteos/);
    } finally { await ctx.close(); }
  });

  test('antes de la hora muestra la cuenta regresiva y no hay ganador', async () => {
    const futura = NP.rondaEn(Date.now() + 90e3);
    const { pub } = await sorteoDePrueba(NP, { n: 10, ronda: futura });
    const { ctx, page, reg } = await nuevaPagina(nav, sitio, { prueba: PRUEBA });
    try {
      await publicar(page, pub);
      await page.goto(sitio.url + '/sorteos/?id=' + pub.id);
      await page.waitForSelector('.sv-cuenta-num');
      assert.match(await page.textContent('.sv-cuenta-num'), /^0[01]:\d{2}$/);
      assert.equal(await page.$$eval('.sv-ganador', (xs) => xs.length), 0);
      assert.ok(!reg.peticiones.some((u) => /drand/.test(new URL(u).host)), 'no pide el azar antes de tiempo');
    } finally { await ctx.close(); }
  });

  test('un archivo cambiado después de publicar se rechaza', async () => {
    const { pub } = await sorteoDePrueba(NP, { n: 10 });
    const trampa = clonar(pub);
    trampa.participantes[0][0] = 'Amigo Del Organizador · …7777';   // la huella publicada ya no coincide
    const { ctx, page } = await nuevaPagina(nav, sitio, { prueba: PRUEBA });
    try {
      await publicar(page, trampa);
      await simularDrand(page, (r) => r.fulfill(jsonCors(RONDA_38)));
      await page.goto(sitio.url + '/sorteos/?id=' + pub.id);
      await page.waitForSelector('.sv-estado .aviso-error');
      assert.match(await page.textContent('.sv-estado'), /No se puede dar este sorteo por válido/);
      assert.match(await page.textContent('.sv-huella-ok'), /NO coincide/);
      assert.equal(await page.$$eval('.sv-ganador', (xs) => xs.length), 0);
    } finally { await ctx.close(); }
  });

  test('si un servidor de drand responde un número falso, no se muestra ningún ganador', async () => {
    const { pub } = await sorteoDePrueba(NP, { n: 10 });
    const falso = { ...RONDA_38, randomness: '0'.repeat(64) };
    const { ctx, page } = await nuevaPagina(nav, sitio, { prueba: PRUEBA });
    try {
      await publicar(page, pub);
      await simularDrand(page, (r) => r.fulfill(jsonCors(falso)));
      await page.goto(sitio.url + '/sorteos/?id=' + pub.id);
      await page.waitForFunction(() => /no pasa la verificación/.test(document.querySelector('.sv-estado')?.textContent || ''));
      assert.equal(await page.$$eval('.sv-ganador', (xs) => xs.length), 0);
    } finally { await ctx.close(); }
  });

  test('cualquiera puede verificar un archivo descargado y ve la revelación comprobada', async () => {
    const { pub, prep } = await sorteoDePrueba(NP, { n: 8, premios: ['Único'] });
    const r = await NP.verificar(pub, NP.comprobarRonda(RONDA_38, 38));
    const g = r.ganadores[0], p = prep.participantes[g.posicion - 1];
    const conRev = { ...clonar(pub), revelaciones: [{ posicion: g.posicion, id: p.id, sal: p.sal }] };
    const { ctx, page } = await nuevaPagina(nav, sitio, { prueba: PRUEBA });
    try {
      await simularDrand(page, (rr) => rr.fulfill(jsonCors(RONDA_38)));
      await page.goto(sitio.url + '/sorteos/');
      await page.setInputFiles('#archivo', { name: 'sorteo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(conRev)) });
      await page.waitForSelector('.sv-ganador .revelado');
      assert.match(await page.textContent('.sv-ganador .revelado'), new RegExp('comprobado: ' + p.id));
      assert.match(await page.textContent('.sv-origen'), /sorteo\.json/);
      // una revelación falsa no se muestra
      const falsa = { ...clonar(pub), revelaciones: [{ posicion: g.posicion, id: 'OTRA-PERSONA', sal: p.sal }] };
      await page.setInputFiles('#archivo', { name: 'falso.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(falsa)) });
      await page.waitForFunction(() => document.querySelector('.sv-origen')?.textContent.includes('falso.json') && document.querySelector('.sv-ganador'));
      assert.equal(await page.$$eval('.sv-ganador .revelado', (xs) => xs.length), 0);
    } finally { await ctx.close(); }
  });
});
