# labs-summit-tests

Pruebas automáticas de **labssummit.com** (repo [`SoulNome/labs-summit-2026`](https://github.com/SoulNome/labs-summit-2026)): seguridad, resistencia a caídas y sorteos verificables.

Las pruebas levantan una copia local del sitio con `wrangler pages dev`, que aplica `_headers`, `_routes.json` y la función `functions/[[ruta]].js` igual que Cloudflare Pages, y la atacan con peticiones HTTP y con un navegador real (Chromium de Playwright). No se necesita internet: drand y los servicios externos se simulan.

## Cómo correrlas

```bash
# las dos carpetas, una al lado de la otra
git clone https://github.com/SoulNome/labs-summit-2026
git clone https://github.com/SoulNome/labs-summit-tests
cd labs-summit-tests
npm install
npx playwright install chromium   # solo la primera vez
npm test                          # todo (≈ 1–2 min)
npm run test:sorteo               # solo el sorteo
npm run test:seguridad            # solo seguridad y caídas
npm run sitio                     # copia local en http://127.0.0.1:8788
```

- `SITIO_DIR=/ruta/a/labs-summit-2026` si las carpetas no están una al lado de la otra.
- `BASE_URL=https://<rama>.<proyecto>.pages.dev npm run test:seguridad` revisa un sitio ya publicado, por ejemplo la vista previa de Cloudflare de una rama. Solo hace peticiones `GET` normales.

## Qué se prueba

| Archivo | Qué comprueba |
|---|---|
| `pruebas/seguridad-cabeceras.test.mjs` | HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy y Permissions-Policy en todas las páginas. Que `/sorteos/` tenga la política estricta (solo scripts propios, sin analítica, Trusted Types). Que `.git`, `.env`, documentos internos, scripts `.bat` y las rutas que buscan los bots (`wp-admin`, `xmlrpc.php`, `phpmyadmin`…) respondan **403**. Que no haya recorrido de carpetas (`../`) ni archivos privados de sorteos publicados. |
| `pruebas/seguridad-navegador.test.mjs` | Enlaces con código malicioso (XSS) en el inicio, el mapa (`?z=`, `?p=`, `?t=`), speakers (`#`) y sorteos (`?id=`): no se ejecuta nada, no se inyecta HTML y la página no se rompe. En `/sorteos/` el navegador bloquea HTML y scripts inyectados. Sin rastreadores en los sorteos. La herramienta del organizador no envía la lista de compradores a ningún servidor. |
| `pruebas/resiliencia.test.mjs` | Con Google Fonts, Clarity, Meta, el bucket R2 y Google Maps caídos, el sitio sigue funcionando. Si fallan servidores de drand se usa el siguiente. Sin internet el sorteo avisa, y al volver la señal muestra el mismo resultado. El mapa abre sin señal después de la primera visita (service worker). |
| `pruebas/sorteo-nucleo.test.mjs` | Acta y huella (SHA-256). Detecta cualquier cambio en la lista, los premios o la ronda. Verificación BLS de drand con una ronda real firmada. Rechaza respuestas falsas de drand. Selección sin sesgo (prueba de chi cuadrado). Lectura de CSV/Excel (`;`, comillas, Windows-1252). Duplicados y revelación del ganador. |
| `pruebas/sorteo-python.test.mjs` | El verificador independiente en Python (`sorteos/verificar.py`) da la misma huella y los mismos ganadores que la página, y detecta archivos manipulados. |
| `pruebas/sorteo-navegador.test.mjs` | El flujo completo: el organizador sube el CSV de Coccoa, filtra pagos pendientes y genera los archivos sin datos personales. La página pública verifica y muestra a los ganadores, la pantalla grande funciona, la cuenta regresiva aparece antes de la hora, y se rechazan un archivo manipulado y un relevo de drand que miente. |

## Por qué no hay prueba de carga contra producción

El sitio es estático y lo sirve la red de Cloudflare, que absorbe picos de tráfico y ataques de denegación de servicio. Bombardear el sitio real durante el evento solo serviría para molestar a los asistentes, o para que Cloudflare bloquee la IP de quien prueba. Lo que sí puede fallar está cubierto en `resiliencia.test.mjs`: servicios de terceros, drand y la señal en el Coliseo.

## Herramientas

- `herramientas/construir-drand-bls.mjs`: genera `labs-summit-2026/sorteos/vendor/drand-bls.min.js`, el verificador de firmas de drand basado en `@noble/curves`, en un solo archivo y sin dependencias externas en la web. Para regenerarlo: `npm run construir:drand-bls`. Si lo cambias, sube el `?v=` en las páginas de sorteos.
- `herramientas/capturas.mjs`: capturas de pantalla de las páginas de sorteos para revisar el diseño.
