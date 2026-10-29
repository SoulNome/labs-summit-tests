// Capturas de pantalla de las páginas de sorteos (para revisar el diseño). Uso: node herramientas/capturas.mjs <carpeta>
import { iniciarSitio } from '../pruebas/_sitio.mjs';
import { chromium, nuevaPagina, simularDrand, jsonCors } from '../pruebas/_navegador.mjs';
import { cargarNucleos, sorteoDePrueba, WALKTHROUGH, RONDA_38 } from '../pruebas/_datos.mjs';
import path from 'node:path';

const dir = process.argv[2] || 'informes/capturas';
const { NP } = cargarNucleos();
const sitio = await iniciarSitio();
const nav = await chromium.launch();
const { pub } = await sorteoDePrueba(NP, { n: 340, titulo: 'Gran sorteo de cierre · Día 2', premios: ['Bono de $500.000 en Dropi', 'Kit Labs Summit + libro firmado'] });
const futuro = (await sorteoDePrueba(NP, { n: 340, titulo: 'Gran sorteo de cierre · Día 2', premios: ['Bono de $500.000 en Dropi', 'Kit Labs Summit + libro firmado'], ronda: NP.rondaEn(Date.now() + 754e3), id: '2026-10-29-1700-futuro' })).pub;
const vistas = [
  ['lista', '/sorteos/', 1280, 900],
  ['detalle', '/sorteos/?id=' + pub.id, 1280, 1800],
  ['detalle-movil', '/sorteos/?id=' + pub.id, 390, 2400],
  ['pantalla-cuenta', '/sorteos/?pantalla&id=' + futuro.id, 1600, 900],
  ['pantalla-ganadores', '/sorteos/?pantalla&id=' + pub.id, 1600, 900],
  ['organizador', '/sorteos/organizador', 1280, 1400],
  ['inicio-seccion', '/#sorteos-asistentes', 1280, 900],
  ['inicio-seccion-movil', '/#sorteos-asistentes', 390, 1100]
];
try {
  for (const [nombre, ruta, ancho, alto] of vistas) {
    const { ctx, page } = await nuevaPagina(nav, sitio, { prueba: { red: WALKTHROUGH } });
    await page.setViewportSize({ width: ancho, height: alto });
    for (const s of [pub, futuro]) await page.route('**/sorteos/datos/' + s.id + '.json', (r) => r.fulfill(jsonCors(s)));
    await page.route('**/sorteos/datos/indice.json', (r) => r.fulfill(jsonCors({ formato: 'labs-summit-sorteo/v1', sorteos: [pub, futuro].map((s) => ({ id: s.id, titulo: s.titulo, ensayo: s.ensayo, ronda: s.azar.ronda, participantes: s.participantes.length, huella: s.huella })) })));
    await simularDrand(page, (r) => r.fulfill(jsonCors(RONDA_38)));
    await page.goto(sitio.url + ruta, { waitUntil: 'load' });
    if (ruta.startsWith('/#')) { await page.evaluate(() => { document.querySelectorAll('.reveal').forEach((e) => e.classList.add('vis')); document.getElementById('sorteos-asistentes').scrollIntoView(); }); }
    await page.waitForTimeout(ruta.includes('pantalla') ? 6000 : 2500);
    await page.screenshot({ path: path.join(dir, nombre + '.png'), fullPage: false });
    await ctx.close();
  }
} finally { await nav.close(); await sitio.cerrar(); }
console.log('capturas en', dir);
