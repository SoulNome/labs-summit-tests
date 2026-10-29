// Arma archivos .xlsx mínimos para las pruebas, con personas inventadas (nunca datos reales).
import { deflateRawSync, crc32 } from 'node:zlib';

/** ZIP con los archivos dados ({ nombre: texto }), guardados tal cual (como Coccoa) o comprimidos (como Excel). */
export function crearZip(archivos, { comprimir = false } = {}) {
  const partes = [], centrales = [];
  let offset = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const datos = Buffer.from(contenido, 'utf8'), nom = Buffer.from(nombre, 'utf8');
    const metodo = comprimir ? 8 : 0, comp = comprimir ? deflateRawSync(datos) : datos, crc = crc32(datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(datos.length, 22); local.writeUInt16LE(nom.length, 26);
    partes.push(local, nom, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(metodo, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nom.length, 28); central.writeUInt32LE(offset, 42);
    centrales.push(central, nom);
    offset += 30 + nom.length + comp.length;
  }
  const cd = Buffer.concat(centrales), fin = Buffer.alloc(22), n = Object.keys(archivos).length;
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(n, 8); fin.writeUInt16LE(n, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, cd, fin]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function letra(i) { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; }

/**
 * .xlsx de una hoja. filas: arreglos de textos. enlaces: { 'P2': '/ticket/sms/123' }.
 * compartidas: textos en sharedStrings.xml (como Excel) en vez de t="str" (como Coccoa).
 */
export function crearXlsx(filas, { enlaces = {}, comprimir = false, compartidas = false, hoja = 'Logs', celdasExtra = {} } = {}) {
  const textos = [], indice = new Map();
  const celda = (v, ref) => {
    if (celdasExtra[ref]) return celdasExtra[ref];
    if (!compartidas) return `<c r="${ref}" t="str"><v>${esc(v)}</v></c>`;
    if (!indice.has(v)) { indice.set(v, textos.length); textos.push(v); }
    return `<c r="${ref}" t="s"><v>${indice.get(v)}</v></c>`;
  };
  const xmlFilas = filas.map((f, i) => `<row r="${i + 1}">${f.map((v, j) => { const ref = letra(j) + (i + 1); return v === '' && !celdasExtra[ref] ? '' : celda(v, ref); }).join('')}</row>`).join('');
  const refs = Object.entries(enlaces);
  const archivos = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(hoja)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${xmlFilas}</sheetData>${refs.length ? '<hyperlinks>' + refs.map(([ref], k) => `<hyperlink ref="${ref}" r:id="rId${k + 1}"/>`).join('') + '</hyperlinks>' : ''}</worksheet>`
  };
  if (refs.length) {
    archivos['xl/worksheets/_rels/sheet1.xml.rels'] = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      refs.map(([, url], k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(url)}" TargetMode="External"/>`).join('') + '</Relationships>';
  }
  if (compartidas) {
    archivos['xl/sharedStrings.xml'] = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${textos.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('')}</sst>`;
  }
  return crearZip(archivos, { comprimir });
}

// Misma forma que el Excel que descarga Coccoa: hoja «Logs», estas 19 columnas y el código de cada boleta
// solo en el enlace de «Visualizar código». En taquilla se repiten el correo y el celular del vendedor.
export const COLUMNAS_COCCOA = ['Dia vendido', 'Nombre', 'Correo', 'Tel.', 'Promotor', 'Precio', 'Comision', 'Id Pago', 'Tipo', 'Etapa', 'Evento',
  'Firma', 'Metodo de pago', 'Valido', 'Cambiar estado', 'Visualizar código', 'Eliminar boleta', 'Entrada', 'Reenviar'];
const INVENTADOS = ['María José Echeverri Gómez', 'Juan Pablo De La Cruz', 'Ana Sofía Rojas', 'Luis Fernando Peña', 'Camila Andrea Torres',
  'Andrés Felipe Patarroyo', 'Valentina Ríos', 'Santiago Muñoz Díaz', 'Daniela Ospina', 'Mateo Costa'];
const ETAPAS = [['👑 VIP ( Día 2)', '💎 Labs Summit 2026 💎 Entrada VIP'], ['🔹 General ( Día 2)', '💎 Labs Summit 2026 💎 General'], ['💎 Diamante ( Día 2)', '💎 Labs Summit 2026 💎 Diamante ( Día 2)']];

export function excelCoccoaFalso({ n = 30, comprimir = false } = {}) {
  const filas = [COLUMNAS_COCCOA], enlaces = {}, codigos = [], personas = [];
  for (let i = 0; i < n; i++) {
    const nombre = INVENTADOS[i % 10] + (i >= 10 ? ' ' + 'BCDEFGHIJK'[Math.floor(i / 10) % 10] + 'ó' : '');
    const correo = i % 7 === 3 ? 'taquilla.labs@example.com' : `persona${i}@example.com`;
    const tel = i % 5 === 2 ? '+57 300-000-0000' : `+57 3${String(i % 100).padStart(2, '0')}-555-${1000 + i}`;
    const pagada = i < 3, [etapa, evento] = ETAPAS[i % 3];
    const codigo = String(1000000000000000000n + BigInt(i) * 829452937n);
    codigos.push(codigo);
    personas.push({ nombre, correo, tel, codigo, pagada });
    filas.push([(46323.8 + i * 0.01).toFixed(11), nombre, correo, tel, i % 2 ? 'Milena' : 'Valentina Summit', pagada ? '149000' : '0', '0',
      pagada ? String(248500 + i) : '0', pagada ? 'Boleta' : 'Cortesia', etapa, evento, 'Labs Summit', pagada ? 'Bold' : 'Efectivo', 'VALIDO',
      'Cambiar', 'Ver código', 'Eliminar', 'None', i % 9 === 0 ? '✓ Reenviada29/10/2026 00:21' : 'Reenviar']);
    enlaces['P' + (i + 2)] = '/ticket/sms/' + codigo;
  }
  return { buffer: crearXlsx(filas, { enlaces, comprimir }), filas, codigos, personas };
}
