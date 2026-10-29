// API del registro en vivo (labssummit.com/participa) y de los sorteos publicados:
// functions/api/[[ruta]].js con una base D1 local, igual que en Cloudflare Pages.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarSitio, CLAVE_PRUEBA } from './_sitio.mjs';
import { cargarNucleos, sorteoDePrueba } from './_datos.mjs';

let sitio, sinBase, baseComoTexto, sinClave, N;
before(async () => {
  ({ N } = cargarNucleos());
  [sitio, sinBase, baseComoTexto, sinClave] = await Promise.all([
    iniciarSitio({ registro: true, limiteIp: 5 }),
    iniciarSitio(),
    iniciarSitio({ variables: ['SORTEO_DB=labs-sorteo', 'SORTEO_CLAVE=' + CLAVE_PRUEBA] }),   // SORTEO_DB puesta como texto, no como base D1
    iniciarSitio({ registro: true, sinClave: true })
  ]);
});
after(async () => { for (const s of [sitio, sinBase, baseComoTexto, sinClave]) await s?.cerrar(); });

// Cada pedido sale de una «conexión» distinta, salvo que la prueba diga otra cosa (el límite es por IP)
let n = 0;
const ipNueva = () => '10.9.' + Math.floor(++n / 250) + '.' + ((n % 250) + 1);
async function pedir(ruta, { metodo = 'GET', cuerpo, ip = ipNueva(), clave, origen, tipo = 'application/json', base = sitio } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  if (cuerpo !== undefined && tipo) headers['Content-Type'] = tipo;
  if (clave) headers.Authorization = 'Bearer ' + clave;
  if (origen) headers.Origin = origen;
  const r = await fetch(base.url + ruta, { method: metodo, headers, body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) });
  const texto = await r.text();
  let d = null;
  try { d = JSON.parse(texto); } catch { /* no es JSON */ }
  return { status: r.status, d, texto, h: r.headers };
}
const inscribir = (datos, op = {}) => pedir('/api/participa', { metodo: 'POST', cuerpo: { autoriza: true, ...datos }, ...op });
const organizador = (ruta, cuerpo) => pedir(ruta, cuerpo === undefined ? { clave: CLAVE_PRUEBA } : { metodo: 'POST', cuerpo, clave: CLAVE_PRUEBA });

describe('registro público', () => {
  test('inscribe una vez por celular, con cualquier forma de escribirlo', async () => {
    const a = await inscribir({ nombre: '  María José   de la Cruz ', celular: '+57 300 123 4567' });
    assert.equal(a.status, 201);
    assert.equal(a.d.ok, true);
    assert.equal(a.d.nuevo, true);
    assert.equal(a.d.etiqueta, 'María J. C. · …4567');
    // el mismo celular con otro nombre: no se duplica y responde con el nombre que quedó registrado
    const b = await inscribir({ nombre: 'Otra Persona', celular: '300-123-4567' });
    assert.equal(b.status, 200);
    assert.equal(b.d.nuevo, false);
    assert.equal(b.d.etiqueta, 'María J. C. · …4567');
    const c = await inscribir({ nombre: 'Persona De Afuera', celular: '+1 555 010 9999' });
    assert.equal(c.status, 201, 'un celular extranjero con + también vale');
    const lista = (await organizador('/api/registros')).d.registros;
    const maria = lista.find((x) => x.celular === '3001234567');
    assert.equal(maria.nombre, 'María José de la Cruz');
    assert.ok(lista.some((x) => x.celular === '+15550109999'));
    assert.equal(lista.filter((x) => x.celular === '3001234567').length, 1);
  });

  test('rechaza datos incompletos o mal escritos y dice qué falta', async () => {
    const r = await inscribir({ nombre: 'A', celular: '6022345678', autoriza: false });
    assert.equal(r.status, 400);
    assert.deepEqual(Object.keys(r.d.errores).sort(), ['autoriza', 'celular', 'nombre']);
    for (const celular of ['12345', '300123456', '30012345678', '', 'tres cero cero']) {
      assert.equal((await inscribir({ nombre: 'Ana Pérez', celular })).status, 400, celular);
    }
    assert.equal((await inscribir({ nombre: '12345 !!!', celular: '3001112233' })).status, 400, 'un nombre sin letras');
    assert.equal((await inscribir({ nombre: 'Ana Pérez', celular: '3001112233', autoriza: 'true' })).status, 400, 'la autorización debe ser true');
  });

  test('el nombre se guarda sin HTML ni caracteres invisibles', async () => {
    const r = await inscribir({ nombre: '<img src=x onerror=alert(1)> Ana‮​ Gómez', celular: '3105550001' });
    assert.equal(r.status, 201);
    const fila = (await organizador('/api/registros')).d.registros.find((x) => x.celular === '3105550001');
    assert.doesNotMatch(fila.nombre, /[<>=()‮​]/);
    assert.match(fila.nombre, /Ana Gómez$/);
  });

  test('el campo trampa engaña a los robots y no guarda nada', async () => {
    const r = await inscribir({ nombre: 'Robot Malo', celular: '3109990000', sitio: 'https://spam.example' });
    assert.equal(r.status, 201);
    assert.equal(r.d.ok, true);
    assert.ok(!(await organizador('/api/registros')).d.registros.some((x) => x.celular === '3109990000'));
  });

  test('solo acepta JSON pequeño y del propio sitio', async () => {
    assert.equal((await pedir('/api/participa', { metodo: 'POST', cuerpo: 'nombre=Ana&celular=3001112233', tipo: 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal((await pedir('/api/participa', { metodo: 'POST', cuerpo: '{"nombre": "Ana"' })).status, 400);
    assert.equal((await pedir('/api/participa', { metodo: 'POST', cuerpo: '[1,2]' })).status, 400);
    assert.equal((await pedir('/api/participa', { metodo: 'POST', cuerpo: { nombre: 'x'.repeat(5000), celular: '3001112233', autoriza: true } })).status, 413);
    assert.equal((await inscribir({ nombre: 'Ana Pérez', celular: '3001112233' }, { origen: 'https://otro-sitio.example' })).status, 403);
    assert.equal((await pedir('/api/participa', { metodo: 'PUT', cuerpo: {} })).status, 405);
    assert.equal((await pedir('/api/participa', { metodo: 'DELETE' })).status, 405);
    assert.equal((await pedir('/api/no-existe')).status, 404);
  });

  test('limita los registros por conexión', async () => {
    const ip = '10.200.0.1';
    for (let i = 0; i < 5; i++) assert.equal((await inscribir({ nombre: 'Persona Repetida', celular: '31200000' + (10 + i) }, { ip })).status, 201);
    const r = await inscribir({ nombre: 'Persona Repetida', celular: '3120000020' }, { ip });
    assert.equal(r.status, 429);
    assert.ok(r.h.get('retry-after'));
    assert.equal((await inscribir({ nombre: 'Otra Conexión', celular: '3120000021' }, { ip: '10.200.0.2' })).status, 201, 'otra conexión sí puede');
  });

  test('el estado es público, en caché corta y sin datos personales', async () => {
    const r = await pedir('/api/participa');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.d).sort(), ['abierto', 'total']);
    assert.equal(r.d.abierto, true);
    assert.equal(r.h.get('cache-control'), 'public, max-age=15');
    assert.equal(r.h.get('x-content-type-options'), 'nosniff');
    assert.match(r.h.get('content-security-policy'), /default-src 'none'/);
    assert.match(r.h.get('content-type'), /application\/json/);
    assert.equal(r.h.get('access-control-allow-origin'), null, 'otros sitios no pueden leerlo');
  });
});

describe('herramientas del organizador (con la clave)', () => {
  test('sin la clave correcta no se ven los registros, y se bloquea tras muchos intentos', async () => {
    assert.equal((await pedir('/api/registros')).status, 401);
    assert.equal((await pedir('/api/registros', { clave: 'clave-equivocada-123' })).status, 401);
    assert.equal((await pedir('/api/registros', { metodo: 'POST', cuerpo: { accion: 'vaciar', confirmar: 'VACIAR' } })).status, 401);
    const ip = '10.201.0.1';
    let ultimo;
    for (let i = 0; i < 21; i++) ultimo = await pedir('/api/registros', { clave: 'no-es-esta-' + i, ip });
    assert.equal(ultimo.status, 429);
    assert.equal((await pedir('/api/registros', { clave: CLAVE_PRUEBA, ip: '10.201.0.2' })).status, 200);
    const r = await organizador('/api/registros');
    assert.equal(r.h.get('cache-control'), 'no-store');
    assert.ok(Array.isArray(r.d.registros));
    assert.deepEqual(Object.keys(r.d.registros[0]).sort(), ['celular', 'creado', 'nombre']);
  });

  test('cerrar y abrir el registro', async () => {
    const c = await organizador('/api/registros', { accion: 'cerrar' });
    assert.equal(c.status, 200);
    assert.equal(c.d.abierto, false);
    const r = await inscribir({ nombre: 'Llega Tarde', celular: '3207770000' });
    assert.equal(r.status, 409);
    assert.equal(r.d.cerrado, true);
    assert.equal((await pedir('/api/participa')).d.abierto, false, 'el estado público se actualiza al momento');
    assert.equal((await organizador('/api/registros', { accion: 'abrir' })).d.abierto, true);
    assert.equal((await inscribir({ nombre: 'Llega Tarde', celular: '3207770000' })).status, 201);
    assert.equal((await organizador('/api/registros', { accion: 'otra' })).status, 400);
  });

  test('quitar un registro y vaciar todos (solo con la palabra VACIAR)', async () => {
    await inscribir({ nombre: 'Para Quitar', celular: '3157770001' });
    const antes = (await organizador('/api/registros')).d.total;
    const q = await organizador('/api/registros', { accion: 'quitar', celular: '+57 315 777 0001' });
    assert.equal(q.status, 200);
    assert.equal(q.d.total, antes - 1);
    assert.equal((await organizador('/api/registros', { accion: 'quitar', celular: '3157770001' })).status, 404);
    assert.equal((await organizador('/api/registros', { accion: 'vaciar' })).status, 400);
    assert.equal((await organizador('/api/registros', { accion: 'vaciar', confirmar: 'vaciar' })).status, 400);
    const v = await organizador('/api/registros', { accion: 'vaciar', confirmar: 'VACIAR' });
    assert.equal(v.status, 200);
    assert.equal(v.d.total, 0);
    assert.deepEqual(v.d.registros, []);
    const otra = await inscribir({ nombre: 'Primera Después', celular: '3001010101' });
    assert.equal(otra.d.total, 1, 'el contador vuelve a empezar');
  });
});

describe('sorteos publicados', () => {
  const futura = () => N.rondaEn(Date.now() + 10 * 60e3);

  test('publica un sorteo oficial antes de su hora y cualquiera lo lee igual', async () => {
    const { pub } = await sorteoDePrueba(N, { n: 30, ronda: futura(), id: '2026-10-29-1500-sorteo-del-celular', titulo: 'Sorteo del celular' });
    const texto = JSON.stringify(pub);
    assert.equal((await pedir('/api/sorteos', { metodo: 'POST', cuerpo: texto })).status, 401, 'sin clave no se publica');
    const p = await organizador('/api/sorteos', texto);
    assert.equal(p.status, 201);
    const uno = await pedir('/api/sorteos?id=' + pub.id);
    assert.equal(uno.status, 200);
    assert.equal(uno.texto, texto, 'se guarda tal cual');
    assert.ok(Date.parse(uno.h.get('x-sorteo-publicado')) <= Date.now());
    assert.equal(uno.h.get('cache-control'), 'public, max-age=15');
    const lista = (await pedir('/api/sorteos')).d.sorteos;
    const x = lista.find((s) => s.id === pub.id);
    assert.deepEqual({ ...x, publicado: undefined }, { id: pub.id, titulo: 'Sorteo del celular', ensayo: false, ronda: pub.azar.ronda, participantes: 30, huella: pub.huella, publicado: undefined });
    // volver a publicar la misma lista (p. ej. con la revelación) sí; otra lista con el mismo nombre no
    assert.equal((await organizador('/api/sorteos', { ...pub, revelaciones: [] })).status, 200);
    const otra = await sorteoDePrueba(N, { n: 31, ronda: pub.azar.ronda, id: pub.id, titulo: 'Sorteo del celular' });
    assert.equal((await organizador('/api/sorteos', otra.pub)).status, 409);
  });

  test('un sorteo oficial no se puede publicar después de que salió su número', async () => {
    const { pub } = await sorteoDePrueba(N, { n: 5, ronda: 38, id: '2023-08-23-1200-tarde' });
    const r = await organizador('/api/sorteos', pub);
    assert.equal(r.status, 409);
    assert.match(r.d.error, /ya pasó/);
    assert.equal((await pedir('/api/sorteos?id=' + pub.id)).status, 404);
    // un ensayo sí (no cuenta), y se puede quitar
    const e = await sorteoDePrueba(N, { n: 5, ronda: 38, id: '2023-08-23-1200-ensayo', ensayo: true });
    assert.equal((await organizador('/api/sorteos', e.pub)).status, 201);
    assert.equal((await pedir('/api/sorteos')).d.sorteos.find((s) => s.id === e.pub.id).ensayo, true);
    assert.equal((await organizador('/api/sorteos', { accion: 'borrar', id: e.pub.id })).status, 200);
    assert.equal((await pedir('/api/sorteos?id=' + e.pub.id)).status, 404);
    assert.equal((await organizador('/api/sorteos', { accion: 'borrar', id: e.pub.id })).status, 404);
  });

  test('rechaza archivos que no son sorteos', async () => {
    const { pub } = await sorteoDePrueba(N, { n: 5, ronda: futura(), id: '2026-10-29-1600-malo' });
    for (const malo of [{ ...pub, formato: 'otro' }, { ...pub, id: '../../etc' }, { ...pub, huella: 'abc' }, { ...pub, participantes: [] }, { ...pub, azar: { ronda: -1 } }]) {
      assert.equal((await organizador('/api/sorteos', malo)).status, 400);
    }
    assert.equal((await pedir('/api/sorteos?id=../../etc/passwd')).status, 404);
    assert.equal((await pedir('/api/sorteos?id=no-existe-este')).status, 404);
  });
});

describe('sin la base de datos (antes de configurar Cloudflare)', () => {
  test('la API responde 503 y el resto del sitio sigue igual', async () => {
    for (const [ruta, op] of [['/api/participa', {}], ['/api/participa', { metodo: 'POST', cuerpo: { nombre: 'Ana Pérez', celular: '3001112233', autoriza: true } }], ['/api/registros', { clave: CLAVE_PRUEBA }], ['/api/sorteos', {}]]) {
      const r = await pedir(ruta, { ...op, base: sinBase });
      assert.equal(r.status, 503, ruta);
      assert.equal(r.d.configurado, false);
      assert.match(r.d.motivo, /Falta enlazar la base.*Bindings.*D1 database.*SORTEO_DB/, 'dice qué falta');
    }
    for (const ruta of ['/', '/participa', '/sorteos/', '/sorteos/organizador', '/robots.txt']) {
      assert.equal((await fetch(sinBase.url + ruta)).status, 200, ruta);
    }
    assert.equal((await fetch(sinBase.url + '/.git/config')).status, 403);
  });

  test('si SORTEO_DB quedó como variable de texto, lo dice', async () => {
    const r = await pedir('/api/participa', { base: baseComoTexto });
    assert.equal(r.status, 503);
    assert.match(r.d.motivo, /variable de texto.*Bindings.*D1 database/);
    assert.ok(!r.texto.includes('labs-sorteo') && !r.texto.includes(CLAVE_PRUEBA), 'no muestra valores de la configuración');
  });

  test('con la base pero sin la clave, el registro funciona y el organizador sabe qué falta', async () => {
    assert.equal((await pedir('/api/participa', { metodo: 'POST', cuerpo: { nombre: 'Ana Pérez', celular: '3001112233', autoriza: true }, base: sinClave })).status, 201);
    const r = await pedir('/api/registros', { clave: CLAVE_PRUEBA, base: sinClave });
    assert.equal(r.status, 503);
    assert.match(r.d.error, /Secret llamado SORTEO_CLAVE/);
  });
});
