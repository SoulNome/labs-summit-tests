/* Verificación de las firmas de drand (esquema bls-unchained-g1-rfc9380, el de «quicknet").
   Es la misma comprobación que hace drand-client (lib/beacon-verification.ts → verifySigOnG1),
   escrita sobre @noble/curves. Se empaqueta en un solo archivo para la página de sorteos:
   herramientas/construir-drand-bls.mjs → labs-summit-2026/sorteos/vendor/drand-bls.min.js */
import { bls12_381 as bls } from '@noble/curves/bls12-381';
import { sha256 } from '@noble/hashes/sha2';

const DST_G1 = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_';

function hexABytes(hex, largo) {
  if (typeof hex !== 'string' || hex.length !== largo * 2 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const b = new Uint8Array(largo);
  for (let i = 0; i < largo; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  return b;
}

// Mensaje firmado en una ronda sin encadenar: sha256(ronda como entero de 8 bytes big-endian)
function mensajeDeRonda(ronda) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(ronda));
  return sha256(b);
}

/** true solo si `firmaHex` es la firma BLS válida de la ronda `ronda` para la clave pública de la red. */
export function verificarFirma(firmaHex, ronda, clavePublicaHex) {
  try {
    if (!Number.isSafeInteger(ronda) || ronda < 1) return false;
    const firma = hexABytes(firmaHex, 48), clave = hexABytes(clavePublicaHex, 96);
    if (!firma || !clave) return false;
    const P = bls.G2.ProjectivePoint.fromHex(clave);   // valida que esté en la curva y en el subgrupo
    const S = bls.G1.ProjectivePoint.fromHex(firma);
    if (S.equals(bls.G1.ProjectivePoint.ZERO)) return false;
    const Hm = bls.G1.hashToCurve(mensajeDeRonda(ronda), { DST: DST_G1 });
    // e(S, G2) == e(H(m), P)  ⇔  e(S, G2) · e(H(m), −P) == 1
    const ePHm = bls.pairing(Hm, P.negate(), true);
    const eGS = bls.pairing(S, bls.G2.ProjectivePoint.BASE, true);
    return bls.fields.Fp12.eql(bls.fields.Fp12.mul(eGS, ePHm), bls.fields.Fp12.ONE);
  } catch (e) {
    return false;
  }
}

/** sha256(firma) en hex: el número aleatorio («randomness») de la ronda. */
export function aleatorioDeFirma(firmaHex) {
  const firma = hexABytes(firmaHex, 48);
  if (!firma) return null;
  return Array.from(sha256(firma), (x) => x.toString(16).padStart(2, '0')).join('');
}
