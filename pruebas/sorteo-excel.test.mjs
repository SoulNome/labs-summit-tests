// Lectura de Excel (.xlsx) sin librerías: el archivo que descarga Coccoa, Excel «normal» y archivos dañados.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { cargarNucleos } from './_datos.mjs';
import { crearXlsx, crearZip, excelCoccoaFalso, COLUMNAS_COCCOA } from './_xlsx.mjs';

let N;
before(() => { ({ N } = cargarNucleos()); });
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

describe('Excel (.xlsx)', () => {
  test('el Excel de Coccoa: títulos, datos y el código de cada boleta sacado del enlace «Ver código»', async () => {
    for (const comprimir of [false, true]) {
      const { buffer, codigos, personas } = excelCoccoaFalso({ n: 25, comprimir });
      assert.equal(N.esZip(ab(buffer)), true);
      const filas = await N.leerXlsx(ab(buffer));
      assert.equal(filas.length, 26);
      assert.deepEqual(filas[0], [...COLUMNAS_COCCOA, 'Código del enlace (Visualizar código)']);
      assert.deepEqual(filas.slice(1).map((f) => f.at(-1)), codigos);
      assert.equal(filas[1][1], personas[0].nombre);
      assert.equal(filas[1][9], '👑 VIP ( Día 2)');
      assert.equal(filas[1][15], 'Ver código');
    }
  });

  test('textos compartidos, texto con formato, guía fonética, celdas vacías, números, booleanos y escapes', async () => {
    const extra = {
      B2: '<c r="B2" t="inlineStr"><is><r><t>Ana </t></r><r><rPr><b/></rPr><t>Gómez</t></r></is></c>',
      C2: '<c r="C2"><v>1234.5</v></c>',
      D2: '<c r="D2" t="b"><v>1</v></c>',
      E2: '<c r="E2" t="str"><f>A2&amp;"x"</f><v>L&amp;S &lt;3 &#x1F451; &#233;</v></c>',
      F2: '<c r="F2" t="inlineStr"><is><t>línea_x000D_dos</t><rPh sb="0" eb="1"><t>FONÉTICA</t></rPh></is></c>'
    };
    const filas = [['Código', 'Nombre', 'Monto', 'Pagó', 'Nota', 'Extra'], ['A-1', 'x', 'x', 'x', 'x', 'x'], ['', '', '', '', '', ''], ['B-2', 'Luis', '', '', '', '']];
    const t = await N.leerXlsx(ab(crearXlsx(filas, { compartidas: true, comprimir: true, celdasExtra: extra })));
    assert.deepEqual(t[0], ['Código', 'Nombre', 'Monto', 'Pagó', 'Nota', 'Extra']);
    assert.deepEqual(t[1], ['A-1', 'Ana Gómez', '1234.5', 'VERDADERO', 'L&S <3 👑 é', 'línea\rdos']);
    assert.equal(t.length, 3, 'la fila vacía se descarta');
    assert.deepEqual(t[2].slice(0, 2), ['B-2', 'Luis']);
  });

  test('un ZIP que se infla más de lo que declara (bomba) se rechaza', async () => {
    const buf = crearXlsx(Array.from({ length: 3000 }, (_, i) => ['fila de relleno número ' + i]), { comprimir: true });
    const firma = Buffer.from([0x50, 0x4b, 0x01, 0x02]), hoja = Buffer.from('xl/worksheets/sheet1.xml');
    for (let p = buf.indexOf(firma); p >= 0; p = buf.indexOf(firma, p + 4)) {
      if (buf.subarray(p + 46, p + 46 + buf.readUInt16LE(p + 28)).equals(hoja)) { buf.writeUInt32LE(10, p + 24); break; }
    }
    await assert.rejects(N.leerXlsx(ab(buf)), /dañado/);
  });

  test('archivos que no son Excel o están cortados', async () => {
    await assert.rejects(N.leerXlsx(ab(Buffer.from('Nombre;Código\nAna;1'))), /no es un Excel/);
    await assert.rejects(N.leerXlsx(ab(crearZip({ 'hola.xml': '<x/>' }))), /no es un Excel/);
    await assert.rejects(N.leerXlsx(ab(Buffer.from(crearXlsx([['a'], ['b']]).subarray(0, 200)))));
    assert.equal(N.esZip(ab(Buffer.from('PK'))), false);
    assert.equal(N.esZip(ab(Buffer.from('Nombre;Código'))), false);
  });

  test('fechas de Excel', () => {
    assert.equal(N.fechaDeExcel('45658.5'), '2025-01-01 12:00');
    assert.equal(N.fechaDeExcel('46324.70833333333'), '2026-10-29 17:00');
    assert.equal(N.fechaDeExcel('LS-12345'), 'LS-12345');
    assert.equal(N.fechaDeExcel('12345'), '12345', 'un número de 5 cifras fuera de rango no es una fecha');
  });

  test('la etiqueta pública puede mostrar los últimos 4 dígitos del celular', async () => {
    const r = await N.prepararParticipantes([
      { id: '1000000000000000000', nombre: 'Ana Gómez', visible: '+57 301-555-1001' },
      { id: '1000000000829452937', nombre: 'Luis Peña', visible: '' },   // sin celular: los del código
      { id: '1000000001658905874', nombre: 'Eva Ríos', visible: null }   // nada
    ]);
    assert.deepEqual(r.participantes.map((p) => p.etiqueta), ['Ana G. · …1001', 'Luis P. · …2937', 'Eva R.']);
  });
});
