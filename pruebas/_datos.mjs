// Datos compartidos por las pruebas.
import { createRequire } from 'node:module';
import path from 'node:path';
import { SITIO_DIR } from './_sitio.mjs';

const require = createRequire(import.meta.url);
export const BUNDLE = path.join(SITIO_DIR, 'sorteos', 'vendor', 'drand-bls.min.js');
export const NUCLEO = path.join(SITIO_DIR, 'sorteos', 'sorteo-nucleo.js');
export const VERIFICADOR_PY = path.join(SITIO_DIR, 'sorteos', 'verificar.py');

// Cadena de drand con el mismo esquema que quicknet (bls-unchained-g1-rfc9380) y una ronda real firmada.
// Fuente: drand-client, test/beacon-verification.test.ts («signatures on G1 with DST»).
export const WALKTHROUGH = {
  nombre: 'walkthrough',
  hash: 'af8b6fc95693b058a3a59efe586eb31c2c352fe00cf40c62a427d87c34f7a235',
  clavePublica: '81d320f220ee9c79e60e19dedc838c31e3ab919b15481e9feb52f643628c4f6a13fdc52129493875a818109d767272ca0541cbcdcea9335f2870d781b39b845ba8cbd44fdfe4967781cf72ca5917fc9398bcf97ca0548ed5a709016c4b1ff0f3',
  genesis: 1687506816,
  periodo: 3,
  esquema: 'bls-unchained-g1-rfc9380',
  relevos: ['https://api.drand.sh', 'https://drand.cloudflare.com']
};
export const RONDA_38 = {
  round: 38,
  randomness: 'b2fc21325a24904a6a9e81a6c63f65f6cec3f0b2400df3f4a56b214770e9ccca',
  signature: '95c93585c513ebbcb4777ff15599b3140e5ec0295faa0e483f3deadd88fa6d43f0d3703e3a4ce106e8fd6c6987f32126'
};

/** Carga el verificador BLS y dos copias del núcleo: N (quicknet, la de producción) y NP (cadena de prueba). */
export function cargarNucleos() {
  globalThis.LSDrandBLS = require(BUNDLE);
  delete require.cache[require.resolve(NUCLEO)];
  delete globalThis.__LS_SORTEO_PRUEBA;
  const N = require(NUCLEO);
  delete require.cache[require.resolve(NUCLEO)];
  globalThis.__LS_SORTEO_PRUEBA = { red: WALKTHROUGH };
  const NP = require(NUCLEO);
  delete globalThis.__LS_SORTEO_PRUEBA;
  delete require.cache[require.resolve(NUCLEO)];
  return { N, NP, BLS: globalThis.LSDrandBLS };
}

export const NOMBRES = ['María José Echeverri', 'JUAN PABLO DE LA CRUZ', 'Ana Sofía Gómez', 'Luis Fernando Peña', 'Camila Rodríguez', 'Andrés Felipe Patarroyo',
  'Valentina Ríos', 'Santiago Muñoz', 'Daniela Ospina', 'Mateo Costa', 'Laura Sánchez', 'Julián Lago'];

/** Sorteo de prueba con la cadena «walkthrough» y la ronda 38 (o la que se pida). */
export async function sorteoDePrueba(NP, { n = 40, premios = ['Bono de $500.000', 'Kit Labs Summit'], ronda = 38, titulo = 'Sorteo de prueba', id = '2026-10-29-1700-sorteo-de-prueba', ensayo = false } = {}) {
  const registros = Array.from({ length: n }, (_, i) => ({ id: 'LS-20669-' + String(1000 + i), nombre: NOMBRES[i % NOMBRES.length], cantidad: 1, fila: [NOMBRES[i % NOMBRES.length], 'LS-20669-' + String(1000 + i), 'Pagado'] }));
  const prep = await NP.prepararParticipantes(registros);
  const pub = await NP.armarPublico({ id, titulo, ensayo, cierre: '2026-10-29T16:45:00-05:00', premios, ronda }, prep.participantes);
  return { pub, prep };
}

export function clonar(x) { return JSON.parse(JSON.stringify(x)); }
