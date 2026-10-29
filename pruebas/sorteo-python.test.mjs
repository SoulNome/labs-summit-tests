// El verificador en Python (sorteos/verificar.py) es otra implementación de la misma fórmula:
// debe dar la misma huella y los mismos ganadores que la página, y detectar un archivo manipulado.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cargarNucleos, clonar, VERIFICADOR_PY } from './_datos.mjs';

const python = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);
let N;
before(() => { ({ N } = cargarNucleos()); });

async function sorteoQuicknet(n, premios) {
  const registros = Array.from({ length: n }, (_, i) => ({ id: 'LS-' + (5000 + i), nombre: ['Ana María Gómez', 'Luis Peña', 'José Núñez'][i % 3] }));
  const prep = await N.prepararParticipantes(registros);
  return N.armarPublico({ id: '2026-10-29-1700-prueba-python', titulo: 'Prueba cruzada «Python»', ensayo: true, cierre: '2026-10-29T16:45:00-05:00', premios, ronda: 30000000 }, prep.participantes);
}
function correr(archivo, aleatorio) {
  return spawnSync(python, ['-I', VERIFICADOR_PY, archivo, '--aleatorio', aleatorio], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
}

test('Python y JavaScript dan la misma huella y los mismos ganadores', { skip: !python && 'no hay Python' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sorteo-'));
  for (const [n, premios] of [[1, ['Único']], [25, ['Primero', 'Segundo', 'Tercero']], [3000, ['A', 'B', 'C', 'D', 'E']]]) {
    const pub = await sorteoQuicknet(n, premios);
    const archivo = path.join(dir, `s-${n}.json`);
    writeFileSync(archivo, JSON.stringify(pub));
    const aleatorio = createHash('sha256').update('ronda ' + n).digest('hex');
    const r = correr(archivo, aleatorio);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp('Huella del acta: ' + pub.huella + '\\s+✓'));
    const js = await N.elegirGanadores(pub.huella, aleatorio, pub.participantes.length, premios.length);
    const py = [...r.stdout.matchAll(/Premio (\d+) \(.*?\): boleta n\.º (\d+)/g)].map((m) => [Number(m[1]) - 1, Number(m[2]) - 1]);
    assert.deepEqual(py, js.map((g) => [g.premio, g.indice]), `n=${n}`);
  }
});

test('Python detecta un archivo manipulado', { skip: !python && 'no hay Python' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sorteo-'));
  const pub = clonar(await sorteoQuicknet(10, ['Premio']));
  pub.participantes[3][0] = 'Otra Persona · …0000';
  const archivo = path.join(dir, 'manipulado.json');
  writeFileSync(archivo, JSON.stringify(pub));
  const r = correr(archivo, 'ab'.repeat(32));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /NO coincide/);
});

test('Python rechaza un azar que no es de quicknet', { skip: !python && 'no hay Python' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sorteo-'));
  const pub = clonar(await sorteoQuicknet(4, ['Premio']));
  pub.azar.hash = '00'.repeat(32);
  const archivo = path.join(dir, 'otra-red.json');
  writeFileSync(archivo, JSON.stringify(pub));
  const r = correr(archivo, 'ab'.repeat(32));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no viene de drand quicknet/);
});

test('el verificador en Python solo usa la biblioteca estándar', { skip: !python && 'no hay Python' }, () => {
  const salida = execFileSync(python, ['-I', '-c', `import ast,sys
t = ast.parse(open(sys.argv[1], encoding='utf-8').read())
m = sorted({a.name.split('.')[0] for n in ast.walk(t) if isinstance(n, ast.Import) for a in n.names} | {n.module.split('.')[0] for n in ast.walk(t) if isinstance(n, ast.ImportFrom)})
print(','.join(m))`, VERIFICADOR_PY], { encoding: 'utf8' }).trim();
  assert.deepEqual(salida.split(','), ['datetime', 'hashlib', 'json', 're', 'sys', 'urllib']);
});
