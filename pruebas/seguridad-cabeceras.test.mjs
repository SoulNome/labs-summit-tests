// Cabeceras de seguridad y rutas sensibles, a nivel HTTP (como lo vería un atacante o un escáner).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarSitio } from './_sitio.mjs';

let sitio;
before(async () => { sitio = await iniciarSitio(); });
after(async () => { await sitio.cerrar(); });

const PAGINAS = ['/', '/speakers', '/mapa/', '/sorteos/', '/sorteos/organizador', '/politica', '/terminos', '/404.html'];
const pedir = (ruta, op) => fetch(sitio.url + ruta, { redirect: 'manual', ...op });

/** Directivas de cada política CSP (puede haber varias, separadas por comas). */
function politicas(valor) {
  return (valor || '').split(',').map((p) => Object.fromEntries(p.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [k, ...v] = d.split(/\s+/);
    return [k.toLowerCase(), v];
  })));
}

describe('cabeceras de seguridad en todas las páginas', () => {
  for (const ruta of PAGINAS) {
    test(ruta, async () => {
      const r = await fetch(sitio.url + ruta);
      const hd = (k) => r.headers.get(k) || '';
      assert.ok(r.status === 200 || (ruta === '/404.html' && r.status === 404), `estado ${r.status}`);
      assert.match(hd('strict-transport-security'), /max-age=(\d{8,})/);
      assert.ok(Number(hd('strict-transport-security').match(/max-age=(\d+)/)[1]) >= 31536000, 'HSTS de al menos un año');
      assert.equal(hd('x-content-type-options'), 'nosniff');
      assert.match(hd('x-frame-options'), /^(SAMEORIGIN|DENY)$/);
      assert.match(hd('referrer-policy'), /strict-origin-when-cross-origin|no-referrer|same-origin/);
      assert.match(hd('permissions-policy'), /camera=\(\)/);
      assert.match(hd('permissions-policy'), /microphone=\(\)/);
      assert.notEqual(hd('access-control-allow-origin'), '*', 'no debe permitir que cualquier sitio lea las respuestas');
      const csp = politicas(hd('content-security-policy'));
      assert.ok(csp.length >= 1, 'tiene CSP');
      const general = csp[0];
      assert.deepEqual(general['object-src'], ["'none'"]);
      assert.ok(general['base-uri'], 'restringe <base>');
      assert.ok(general['frame-ancestors'], 'impide que otros sitios la metan en un iframe');
      assert.ok('upgrade-insecure-requests' in general);
      for (const p of csp) {
        assert.ok(!(p['script-src'] || []).includes("'unsafe-eval'"), 'sin unsafe-eval');
        assert.ok(!(p['script-src'] || []).includes('*'), 'sin comodín en script-src');
        assert.ok(!(p['script-src'] || []).some((s) => s === 'http:' || s === 'https:'), 'script-src no acepta cualquier dominio');
      }
    });
  }
});

describe('sorteos: política estricta', () => {
  for (const ruta of ['/sorteos/', '/sorteos/organizador', '/sorteos/datos/indice.json']) {
    test(ruta, async () => {
      const r = await fetch(sitio.url + ruta);
      const csp = politicas(r.headers.get('content-security-policy'));
      assert.equal(csp.length, 2, 'política general + política estricta');
      const estricta = csp[1];
      assert.deepEqual(estricta['default-src'], ["'none'"]);
      assert.deepEqual(estricta['script-src'], ["'self'"], 'solo scripts propios: sin analítica ni scripts en línea');
      assert.deepEqual(estricta['frame-ancestors'], ["'none'"]);
      assert.deepEqual(estricta['form-action'], ["'none'"]);
      assert.deepEqual(estricta['require-trusted-types-for'], ["'script'"]);
      assert.ok(estricta['connect-src'].every((o) => o === "'self'" || /^https:\/\/(api\d?\.drand\.sh|drand\.cloudflare\.com)$/.test(o)), 'solo se conecta a drand');
      // la política general debe permitir lo mismo, o el navegador lo bloquearía
      for (const o of estricta['connect-src']) assert.ok(csp[0]['connect-src'].includes(o), o + ' también en la general');
    });
  }
  test('la herramienta del organizador no se indexa en buscadores', async () => {
    assert.match((await fetch(sitio.url + '/sorteos/organizador')).headers.get('x-robots-tag') || '', /noindex/);
  });
  test('el índice de sorteos es JSON válido', async () => {
    const r = await fetch(sitio.url + '/sorteos/datos/indice.json');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.formato, 'labs-summit-sorteo/v1');
    assert.ok(Array.isArray(j.sorteos));
  });
  test('no hay archivos privados de sorteos publicados', async () => {
    const j = await (await fetch(sitio.url + '/sorteos/datos/indice.json')).json();
    for (const s of j.sorteos) {
      const r = await pedir('/sorteos/datos/' + s.id + '.privado.json');
      assert.notEqual(r.status, 200, s.id);
    }
  });
});

describe('rutas sensibles bloqueadas', () => {
  const BLOQUEADAS = ['/.git/config', '/.git/HEAD', '/.env', '/.vscode/settings.json', '/functions/[[ruta]].js', '/documents/Autorizacion.docx',
    '/Informe_LabsSummit_2026.docx', '/Informe_LabsSummit_2026.pptx', '/Acompanamiento_LabsSummit_2026.docx', '/commit-y-push.bat', '/push-to-github.ps1',
    '/node_modules/x/package.json', '/_originales/foto.jpg', '/wp-login.php', '/wp-admin/', '/xmlrpc.php', '/phpmyadmin/', '/admin/', '/config.php', '/server-status'];
  for (const ruta of BLOQUEADAS) {
    test(ruta + ' → 403', async () => {
      const r = await pedir(ruta);
      assert.equal(r.status, 403);
      assert.match(r.headers.get('x-robots-tag') || '', /noindex/);
      assert.match(r.headers.get('cache-control') || '', /no-store/);
      assert.match(await r.text(), /Acceso restringido/);
    });
  }
  for (const ruta of ['/_headers', '/%2e%2e/%2e%2e/etc/passwd', '/sorteos/..%2f_headers', '/..%2f..%2fetc%2fpasswd', '/sorteos/datos/x.privado.json']) {
    test(ruta + ' no entrega archivos internos', async () => {
      const r = await pedir(ruta);
      assert.notEqual(r.status, 200);
      assert.doesNotMatch(await r.text(), /root:x:0:0|Content-Security-Policy:/);
    });
  }
  test('métodos de escritura no hacen nada', async () => {
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await pedir('/', { method: m, body: m === 'DELETE' ? undefined : 'x' });
      assert.ok(r.status >= 400, `${m} → ${r.status}`);
    }
  });
});

describe('páginas de error', () => {
  test('404 propia y sin indexar', async () => {
    const r = await pedir('/esta-pagina-no-existe');
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type') || '', /text\/html/);
  });
});
