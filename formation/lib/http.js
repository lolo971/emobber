// Outils HTTP partagés par le serveur de formation et la boutique.

export const TAILLE_JSON = 2 * 1024 * 1024;

export const ENTETES_SECURITE = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob: https:",
    "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'",
  ].join('; '),
};

export class ErreurHttp extends Error {
  constructor(statut, message, details) { super(message); this.statut = statut; this.details = details; }
}

export function envoyer(res, statut, corps, entetes = {}) {
  const json = typeof corps !== 'string';
  res.writeHead(statut, {
    ...ENTETES_SECURITE,
    'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...entetes,
  });
  res.end(json ? JSON.stringify(corps) : corps);
}

export function lireCorps(req, limite) {
  return new Promise((ok, ko) => {
    const morceaux = [];
    let taille = 0;
    req.on('data', (m) => {
      taille += m.length;
      if (taille > limite) { ko(new ErreurHttp(413, 'Fichier ou contenu trop volumineux.')); req.destroy(); return; }
      morceaux.push(m);
    });
    req.on('end', () => ok(Buffer.concat(morceaux)));
    req.on('error', ko);
  });
}

export async function lireJson(req) {
  try {
    return JSON.parse((await lireCorps(req, TAILLE_JSON)).toString('utf8'));
  } catch (e) {
    if (e instanceof ErreurHttp) throw e;
    throw new ErreurHttp(400, 'Contenu JSON invalide.');
  }
}

export function lireCookie(req, nom) {
  for (const morceau of (req.headers.cookie || '').split(';')) {
    const [cle, ...valeur] = morceau.trim().split('=');
    if (cle === nom) return decodeURIComponent(valeur.join('='));
  }
  return null;
}
