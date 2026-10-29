// Pruebas del núcleo del sorteo (sin navegador): acta, huella, manipulación, azar de drand y ganadores.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bls12_381 as bls } from '@noble/curves/bls12-381';
import { cargarNucleos, sorteoDePrueba, clonar, WALKTHROUGH, RONDA_38 } from './_datos.mjs';

let N, NP, BLS;
before(() => { ({ N, NP, BLS } = cargarNucleos()); });
const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

describe('red de drand (quicknet)', () => {
  test('usa los datos publicados de quicknet', () => {
    assert.equal(N.RED.nombre, 'quicknet');
    assert.equal(N.RED.hash, '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971');
    assert.equal(N.RED.genesis, 1692803367);
    assert.equal(N.RED.periodo, 3);
    assert.equal(N.RED.esquema, 'bls-unchained-g1-rfc9380');
  });
  test('la clave pública es un punto válido de G2 (BLS12-381)', () => {
    assert.doesNotThrow(() => bls.G2.ProjectivePoint.fromHex(N.RED.clavePublica));
  });
  test('ronda ↔ hora', () => {
    assert.equal(N.rondaEn(N.RED.genesis * 1000), 1);
    for (const r of [2, 1000, 12345678]) {
      assert.equal(N.rondaEn(N.horaDeRonda(r)), r);
      assert.equal(N.rondaEn(N.horaDeRonda(r) + 1), r + 1);
      assert.equal(N.rondaEn(N.horaDeRonda(r) - 1), r);
    }
  });
});

describe('verificación BLS de una ronda', () => {
  test('acepta la ronda 38 real de la cadena de prueba', () => {
    assert.equal(BLS.verificarFirma(RONDA_38.signature, 38, WALKTHROUGH.clavePublica), true);
    const r = NP.comprobarRonda(RONDA_38, 38);
    assert.ok(r);
    assert.equal(r.aleatorio, RONDA_38.randomness);
  });
  test('rechaza otra ronda, aleatorio cambiado o firma alterada', () => {
    assert.equal(NP.comprobarRonda(RONDA_38, 39), null);
    assert.equal(NP.comprobarRonda({ ...RONDA_38, round: 39 }, 39), null);
    assert.equal(NP.comprobarRonda({ ...RONDA_38, randomness: 'f'.repeat(64) }, 38), null);
    const firma = RONDA_38.signature.split('');
    firma[20] = firma[20] === 'a' ? 'b' : 'a';
    const alterada = firma.join('');
    assert.equal(NP.comprobarRonda({ ...RONDA_38, signature: alterada, randomness: sha(Buffer.from(alterada, 'hex')) }, 38), null);
  });
  test('una firma de otra cadena no vale en quicknet', () => {
    assert.equal(N.comprobarRonda(RONDA_38, 38), null);
  });
  test('datos basura no rompen la verificación', () => {
    for (const x of [null, {}, { round: 38 }, { round: 38, signature: 'zz', randomness: 'zz' }, { round: 38, signature: '00'.repeat(48), randomness: sha(Buffer.alloc(48)) }]) {
      assert.equal(NP.comprobarRonda(x, 38), null);
    }
  });
});

describe('textos y etiquetas', () => {
  test('limpiar quita saltos de línea, «|» y caracteres de control', () => {
    assert.equal(N.limpiar('  Juan\n|  Pérez\u0007  '), 'Juan Pérez');
    assert.equal(N.limpiar(null), '');
  });
  test('identificadores normalizados', () => {
    assert.equal(N.normalizarId('1.116.234.567'), '1116234567');
    assert.equal(N.normalizarId(' 1116 234-567 '), '1116234567');
    assert.equal(N.normalizarId('maria@Gmail.com'), 'MARIA@GMAIL.COM');
    assert.equal(N.normalizarId('ls 20669 0153'), 'LS206690153');
    // el mismo celular escrito de distintas formas en el formulario del QR
    for (const cel of ['+57 300 123 4567', '3001234567', '573001234567', '(300) 123-4567', '300.123.4567']) assert.equal(N.normalizarId(cel), '3001234567', cel);
    assert.equal(N.normalizarId('1000000000829452937'), '1000000000829452937', 'un código largo no se toma por celular');
  });
  test('nombre corto: primer nombre + iniciales, sin partículas', () => {
    assert.equal(N.nombreCorto('MARÍA JOSÉ ECHEVERRI'), 'María J. E.');
    assert.equal(N.nombreCorto('juan pablo de la cruz'), 'Juan P. C.');
    assert.equal(N.nombreCorto('Ana'), 'Ana');
    assert.equal(N.nombreCorto('   '), '');
  });
  test('id corto: últimos 4 caracteres o correo enmascarado', () => {
    assert.equal(N.idCorto('1.116.234.567'), '…4567');
    assert.equal(N.idCorto('maria.jose@gmail.com'), 'ma…@gm…');
    assert.equal(N.idCorto('ls-20669-0153'), '…0153');
    assert.equal(N.etiquetaDe('Camila Rodríguez', 'LS-20669-0153'), 'Camila R. · …0153');
    assert.equal(N.etiquetaDe('', ''), 'Participante');
  });
  test('id del sorteo seguro para URL', () => {
    const id = N.idSorteo('¡Gran Sorteo de Cierre! «Día 2»', Date.parse('2026-10-29T17:00:00-05:00'));
    assert.equal(id, '2026-10-29-1700-gran-sorteo-de-cierre-dia-2');
    assert.match(id, N.RE_ID);
  });
});

describe('lectura de tablas', () => {
  test('pegado desde Excel (tabulaciones)', () => {
    assert.deepEqual(N.leerTabla('Nombre\tCódigo\nAna\tA1\n\nLuis\tB2\n'), [['Nombre', 'Código'], ['Ana', 'A1'], ['Luis', 'B2']]);
  });
  test('CSV con punto y coma, comillas, saltos dentro de comillas, BOM y CRLF', () => {
    const t = '﻿Nombre;Código;Nota\r\n"Pérez; Ana";A1;"dijo ""hola"""\r\n"Luis\nFernando";B2;\r\n';
    assert.deepEqual(N.leerTabla(t), [['Nombre', 'Código', 'Nota'], ['Pérez; Ana', 'A1', 'dijo "hola"'], ['Luis\nFernando', 'B2', '']]);
  });
  test('CSV con comas', () => {
    assert.deepEqual(N.leerTabla('a,b\n1,"x,y"'), [['a', 'b'], ['1', 'x,y']]);
  });
  test('archivo de Excel en Windows-1252 se lee con tildes', () => {
    const bytes = Buffer.from([0x4a, 0x6f, 0x73, 0xe9, 0x3b, 0x4e, 0xfa, 0xf1, 0x65, 0x7a]);   // «José;Núñez» en cp1252
    assert.equal(N.decodificar(bytes), 'José;Núñez');
    assert.equal(N.decodificar(Buffer.from('José;Núñez', 'utf8')), 'José;Núñez');
  });
});

describe('lista de participantes', () => {
  test('quita duplicados y filas sin identificador; cantidad crea una participación por boleta', async () => {
    const r = await N.prepararParticipantes([
      { id: 'A-1', nombre: 'Ana Gómez' },
      { id: 'a 1', nombre: 'Ana Gómez' },        // el mismo código escrito distinto
      { id: '', nombre: 'Sin código' },
      { id: 'B-2', nombre: 'Luis Peña', cantidad: '3' },
      { id: 'C-3', nombre: 'Eva', cantidad: 'x' }
    ]);
    assert.equal(r.sinId, 1);
    assert.equal(r.duplicados, 1);
    assert.equal(r.participantes.length, 5);
    assert.deepEqual(r.participantes.map((p) => p.id), ['A1', 'B2#1', 'B2#2', 'B2#3', 'C3']);
    assert.equal(r.participantes[2].etiqueta, 'Luis P. · …B2 · 2/3');
  });
  test('cada compromiso es sha256(LS-SORTEO|entrada|sal|id) con sal aleatoria de 128 bits', async () => {
    const r = await N.prepararParticipantes([{ id: '123', nombre: 'Ana' }, { id: '456', nombre: 'Luis' }]);
    for (const p of r.participantes) {
      assert.match(p.sal, /^[0-9a-f]{32}$/);
      assert.equal(p.compromiso, sha('LS-SORTEO|entrada|' + p.sal + '|' + p.id));
    }
    assert.notEqual(r.participantes[0].sal, r.participantes[1].sal);
  });
});

describe('acta, huella y manipulación', () => {
  test('la huella es sha256 del acta y el acta tiene el formato documentado', async () => {
    const { pub } = await sorteoDePrueba(NP, { n: 3, premios: ['Premio único'] });
    const acta = NP.textoActa(pub);
    assert.equal(pub.huella, sha(acta));
    const lineas = acta.split('\n');
    assert.deepEqual(lineas.slice(0, 12), [
      'LABS SUMMIT 2026 · ACTA DE SORTEO', 'formato: labs-summit-sorteo/v1', 'id: 2026-10-29-1700-sorteo-de-prueba',
      'titulo: Sorteo de prueba', 'ensayo: no', 'cierre de lista: 2026-10-29T16:45:00-05:00', 'premios: 1', 'premio 1: Premio único',
      'azar: drand walkthrough ' + WALKTHROUGH.hash, 'ronda: 38', 'participantes: 3', '---'
    ]);
    assert.equal(lineas[12], '1|' + pub.participantes[0][0] + '|' + pub.participantes[0][1]);
    assert.equal(acta.endsWith('\n'), true);
  });
  test('cualquier cambio después de publicar se detecta', async () => {
    const { pub } = await sorteoDePrueba(NP);
    const cambios = {
      'cambiar una etiqueta': (s) => { s.participantes[5][0] = 'Otra Persona · …9999'; },
      'cambiar un compromiso': (s) => { s.participantes[5][1] = sha('otro'); },
      'agregar un participante': (s) => { s.participantes.push(['Intruso · …0000', sha('intruso')]); },
      'quitar un participante': (s) => { s.participantes.pop(); },
      'intercambiar dos': (s) => { const t = s.participantes[1]; s.participantes[1] = s.participantes[2]; s.participantes[2] = t; },
      'cambiar un premio': (s) => { s.premios[0] = 'Bono de $50.000'; },
      'cambiar la ronda': (s) => { s.azar.ronda = 39; },
      'cambiar la hora de cierre': (s) => { s.cierre = '2026-10-29T17:30:00-05:00'; },
      'marcar como no ensayo': (s) => { s.ensayo = !s.ensayo; }
    };
    const ok = await NP.verificar(pub);
    assert.equal(ok.huellaOk, true);
    for (const [nombre, cambiar] of Object.entries(cambios)) {
      const s = clonar(pub);
      cambiar(s);
      const r = await NP.verificar(s);
      assert.equal(r.huellaOk, false, nombre);
      assert.ok(r.problemas.length, nombre);
    }
  });
  test('validar() rechaza archivos con formato peligroso o incompleto', async () => {
    const { pub } = await sorteoDePrueba(NP, { n: 4, premios: ['Uno'] });
    const malos = {
      'id con ruta': (s) => { s.id = '../../_headers'; },
      'salto de línea en etiqueta': (s) => { s.participantes[0][0] = 'Ana\n2|x|y'; },
      '«|» en etiqueta': (s) => { s.participantes[0][0] = 'Ana|B'; },
      'compromiso no hexadecimal': (s) => { s.participantes[0][1] = 'zz'; },
      'compromisos repetidos': (s) => { s.participantes[1][1] = s.participantes[0][1]; },
      'otra red de azar': (s) => { s.azar.hash = '00'.repeat(32); },
      'más premios que participantes': (s) => { s.premios = ['a', 'b', 'c', 'd', 'e']; },
      'ensayo no booleano': (s) => { s.ensayo = 'no'; },
      'fecha inválida': (s) => { s.cierre = 'ayer'; },
      'sin participantes': (s) => { s.participantes = []; }
    };
    assert.deepEqual(NP.validar(pub), []);
    for (const [nombre, romper] of Object.entries(malos)) {
      const s = clonar(pub);
      romper(s);
      assert.ok(NP.validar(s).length > 0, nombre);
    }
    assert.ok(NP.validar(null).length > 0);
  });
});

describe('ganadores', () => {
  test('mismo resultado siempre, sin repetir ganadores', async () => {
    const h = sha('acta'), a = sha('aleatorio');
    const g1 = await N.elegirGanadores(h, a, 50, 10);
    const g2 = await N.elegirGanadores(h, a, 50, 10);
    assert.deepEqual(g1, g2);
    assert.equal(new Set(g1.map((x) => x.indice)).size, 10);
    assert.ok(g1.every((x) => x.indice >= 0 && x.indice < 50));
  });
  test('la primera elección es sha256(formato|huella|aleatorio|0|0) mod N', async () => {
    const h = sha('acta'), a = sha('aleatorio');
    const [g] = await N.elegirGanadores(h, a, 37, 1);
    const x = BigInt('0x' + sha('labs-summit-sorteo/v1|' + h + '|' + a + '|0|0'));
    assert.equal(g.indice, Number(x % 37n));
  });
  test('si todos ganan, sale una permutación completa', async () => {
    const g = await N.elegirGanadores(sha('x'), sha('y'), 9, 9);
    assert.deepEqual(g.map((x) => x.indice).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  test('el azar no favorece a ninguna posición (chi cuadrado)', async () => {
    const n = 7, veces = 7000, cuenta = new Array(n).fill(0);
    for (let i = 0; i < veces; i++) {
      const [g] = await N.elegirGanadores(sha('acta'), sha('ronda ' + i), n, 1);
      cuenta[g.indice]++;
    }
    const esperado = veces / n;
    const chi2 = cuenta.reduce((s, c) => s + (c - esperado) ** 2 / esperado, 0);
    assert.ok(chi2 < 22.46, `chi² = ${chi2.toFixed(2)} con ${cuenta.join(',')} (límite p=0,001 con 6 g.l.: 22,46)`);
  });
  test('verificar() con la ronda real da los ganadores del acta', async () => {
    const { pub } = await sorteoDePrueba(NP);
    const ronda = NP.comprobarRonda(RONDA_38, 38);
    const r1 = await NP.verificar(pub, ronda), r2 = await NP.verificar(clonar(pub), ronda);
    assert.deepEqual(r1.problemas, []);
    assert.equal(r1.ganadores.length, 2);
    assert.deepEqual(r1.ganadores.map((g) => g.posicion), r2.ganadores.map((g) => g.posicion));
    assert.equal(r1.ganadores[0].etiqueta, pub.participantes[r1.ganadores[0].posicion - 1][0]);
    const otra = await NP.verificar(pub, { ...ronda, ronda: 39 });
    assert.ok(otra.problemas.length);
  });
  test('la revelación del ganador se comprueba contra su compromiso', async () => {
    const { pub, prep } = await sorteoDePrueba(NP, { n: 5 });
    const p = prep.participantes[2];
    assert.equal(await NP.comprobarRevelacion(pub, { posicion: 3, sal: p.sal, id: p.id }), true);
    assert.equal(await NP.comprobarRevelacion(pub, { posicion: 3, sal: p.sal, id: 'LS200691099' }), false);
    assert.equal(await NP.comprobarRevelacion(pub, { posicion: 2, sal: p.sal, id: p.id }), false);
    assert.equal(await NP.comprobarRevelacion(pub, { posicion: 99, sal: p.sal, id: p.id }), false);
  });
});

describe('pedir la ronda a drand (relevos simulados)', () => {
  const original = globalThis.fetch;
  function simular(respuestas) {
    const pedidas = [];
    globalThis.fetch = async (url) => {
      pedidas.push(url);
      const r = respuestas.shift();
      if (r === 'red') throw new TypeError('Failed to fetch');
      return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status || 200 });
    };
    return pedidas;
  }
  test('si un relevo miente, se usa el siguiente que da una firma válida', async () => {
    const pedidas = simular([{ body: { ...RONDA_38, randomness: 'a'.repeat(64) } }, { body: RONDA_38 }]);
    try {
      const r = await NP.pedirRonda(38);
      assert.equal(r.aleatorio, RONDA_38.randomness);
      assert.equal(r.relevo, WALKTHROUGH.relevos[1]);
      assert.equal(pedidas[0], WALKTHROUGH.relevos[0] + '/' + WALKTHROUGH.hash + '/public/38');
    } finally { globalThis.fetch = original; }
  });
  test('ronda que aún no sale → «pendiente»', async () => {
    simular([{ status: 425, body: {} }, { status: 404, body: {} }]);
    try { await assert.rejects(NP.pedirRonda(38), (e) => e.tipo === 'pendiente'); } finally { globalThis.fetch = original; }
  });
  test('sin conexión → «red»; solo respuestas falsas → «invalida»', async () => {
    simular(['red', 'red']);
    try { await assert.rejects(NP.pedirRonda(38), (e) => e.tipo === 'red'); } finally { globalThis.fetch = original; }
    simular([{ body: 'no es json' }, { body: { ...RONDA_38, round: 39 } }]);
    try { await assert.rejects(NP.pedirRonda(38), (e) => e.tipo === 'invalida'); } finally { globalThis.fetch = original; }
  });
});
