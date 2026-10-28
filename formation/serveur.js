#!/usr/bin/env node
// Serveur de l'outil de formation AKASHA : site apprenant, back-office, API et médias.
// Aucune dépendance : Node 18+ suffit.
//
// Variables d'environnement :
//   FORMATION_MOT_DE_PASSE  mot de passe initial / de secours du back-office. Dès que l'administrateur
//                           change son mot de passe dans le back-office, c'est l'empreinte stockée dans
//                           <données>/admin.json qui fait foi ; supprimer ce fichier rétablit celui-ci.
//   FORMATION_DONNEES       dossier des données (défaut : ./donnees)
//   FORMATION_PORT          port d'écoute (défaut : 8092)
//   FORMATION_HOTE          adresse d'écoute (défaut : 127.0.0.1 ; 0.0.0.0 pour le réseau local)

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, rename, mkdir, readdir, stat, copyFile, unlink } from 'node:fs/promises';
import { join, extname, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { normaliserFormation, verifierFormation, idUnique, slug, ID_VALIDE, reglesNonRespectees } from './public/commun/valider.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ICI, 'public');
const DONNEES = resolve(process.env.FORMATION_DONNEES || join(ICI, 'donnees'));
const DOSSIERS = {
  formations: join(DONNEES, 'formations'),
  medias: join(DONNEES, 'medias'),
  historique: join(DONNEES, 'historique'),
  corbeille: join(DONNEES, 'corbeille'),
};
const PORT = Number(process.env.FORMATION_PORT || 8092);
const HOTE = process.env.FORMATION_HOTE || '127.0.0.1';
const MOT_DE_PASSE = process.env.FORMATION_MOT_DE_PASSE || '';

const DUREE_SESSION = 12 * 3600 * 1000;
const TAILLE_JSON = 2 * 1024 * 1024;
const TAILLE_IMAGE = 8 * 1024 * 1024;
const VERSIONS_GARDEES = 30;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const ENTETES_SECURITE = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob: https:",
    "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'",
  ].join('; '),
};

// ---------- Données ----------

async function preparerDonnees() {
  for (const d of Object.values(DOSSIERS)) await mkdir(d, { recursive: true });
  // Au tout premier démarrage, copie les données initiales absentes (sans rien écraser).
  const marqueur = join(DONNEES, '.initialise');
  if (!(await existe(marqueur))) {
    const initiales = join(ICI, 'donnees-initiales');
    for (const sous of ['formations', 'medias']) {
      const source = join(initiales, sous);
      if (!(await existe(source))) continue;
      for (const f of await readdir(source)) {
        if (!(await existe(join(DOSSIERS[sous], f)))) await copyFile(join(source, f), join(DOSSIERS[sous], f));
      }
    }
    console.log('Données initiales copiées dans', DONNEES);
  }
  await writeFile(marqueur, new Date().toISOString());
}

async function existe(chemin) {
  try { await stat(chemin); return true; } catch { return false; }
}

const cheminFormation = (id) => join(DOSSIERS.formations, `${id}.json`);

async function lireFormation(id) {
  if (!ID_VALIDE.test(id)) return null;
  try {
    return normaliserFormation(JSON.parse(await readFile(cheminFormation(id), 'utf8')));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function listerFormations() {
  const fichiers = (await readdir(DOSSIERS.formations)).filter((f) => f.endsWith('.json'));
  const formations = await Promise.all(fichiers.map((f) => lireFormation(f.slice(0, -5))));
  return formations.filter(Boolean).sort((a, b) => a.titre.localeCompare(b.titre, 'fr'));
}

function resumer(f) {
  return {
    id: f.id, titre: f.titre, sousTitre: f.sousTitre, description: f.description, image: f.image,
    publie: f.publie, modifieLe: f.modifieLe, nbNiveaux: f.niveaux.length,
    niveaux: f.niveaux.map((n) => n.id),
  };
}

// Écriture atomique + copie de la version précédente dans l'historique.
async function ecrireFormation(formation) {
  const chemin = cheminFormation(formation.id);
  if (await existe(chemin)) {
    const dossier = join(DOSSIERS.historique, formation.id);
    await mkdir(dossier, { recursive: true });
    await copyFile(chemin, join(dossier, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    const versions = (await readdir(dossier)).sort();
    for (const ancienne of versions.slice(0, Math.max(0, versions.length - VERSIONS_GARDEES))) {
      await unlink(join(dossier, ancienne));
    }
  }
  const temporaire = `${chemin}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporaire, `${JSON.stringify(formation, null, 2)}\n`);
  await rename(temporaire, chemin);
}

// ---------- Sessions du back-office ----------

const sessions = new Map();
const echecs = new Map();

const scryptAsync = promisify(scrypt);
const FICHIER_ADMIN = join(DONNEES, 'admin.json');
const LIMITE_ESSAIS = 5;
const FENETRE_ESSAIS = 15 * 60 * 1000;

function empreinte(texte) {
  return createHash('sha256').update(String(texte)).digest();
}

// Le mot de passe choisi dans le back-office (empreinte scrypt) prime sur celui de l'environnement.
async function lireAdmin() {
  try {
    const admin = JSON.parse(await readFile(FICHIER_ADMIN, 'utf8'));
    return admin?.algo === 'scrypt' && admin.sel && admin.empreinte ? admin : null;
  } catch {
    return null;
  }
}

async function backOfficeActif() {
  return Boolean(MOT_DE_PASSE) || Boolean(await lireAdmin());
}

async function motDePasseCorrect(propose) {
  if (typeof propose !== 'string' || !propose) return false;
  const admin = await lireAdmin();
  if (admin) {
    const calcule = await scryptAsync(propose, Buffer.from(admin.sel, 'hex'), 64);
    return timingSafeEqual(calcule, Buffer.from(admin.empreinte, 'hex'));
  }
  if (!MOT_DE_PASSE) return false;
  return timingSafeEqual(empreinte(propose), empreinte(MOT_DE_PASSE));
}

async function enregistrerMotDePasse(nouveau) {
  const sel = randomBytes(16);
  const calcule = await scryptAsync(nouveau, sel, 64);
  const contenu = { algo: 'scrypt', sel: sel.toString('hex'), empreinte: calcule.toString('hex'), modifieLe: new Date().toISOString() };
  const temporaire = `${FICHIER_ADMIN}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporaire, `${JSON.stringify(contenu, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaire, FICHIER_ADMIN);
}

// Limite les essais ratés par adresse (connexion et changement de mot de passe).
function verifierLimite(req) {
  const t = echecs.get(adresseClient(req));
  if (t && t.nombre >= LIMITE_ESSAIS && Date.now() - t.depuis < FENETRE_ESSAIS) {
    throw new ErreurHttp(429, 'Trop d\'essais. Réessayez dans un quart d\'heure.');
  }
}

function noterEchec(req) {
  const ip = adresseClient(req);
  const t = echecs.get(ip);
  const actuel = t && Date.now() - t.depuis < FENETRE_ESSAIS ? t : { nombre: 0, depuis: Date.now() };
  echecs.set(ip, { ...actuel, nombre: actuel.nombre + 1 });
}

function lireCookie(req, nom) {
  for (const morceau of (req.headers.cookie || '').split(';')) {
    const [cle, ...valeur] = morceau.trim().split('=');
    if (cle === nom) return decodeURIComponent(valeur.join('='));
  }
  return null;
}

function estConnecte(req) {
  const jeton = lireCookie(req, 'formation_session');
  const fin = jeton && sessions.get(jeton);
  if (!fin) return false;
  if (fin < Date.now()) { sessions.delete(jeton); return false; }
  return true;
}

// Les en-têtes de proxy ne sont crus que s'ils viennent de la machine elle-même (tunnel cloudflared,
// Apache) : un appareil du réseau local ne peut pas se faire passer pour un autre.
const BOUCLE = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const viaProxyLocal = (req) => BOUCLE.has(req.socket.remoteAddress);

function adresseClient(req) {
  if (viaProxyLocal(req)) {
    const relayee = req.headers['cf-connecting-ip'] || req.headers['x-real-ip']
      || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (relayee) return String(relayee);
  }
  return String(req.socket.remoteAddress || '');
}

// Requête venue d'Internet (relayée par le tunnel ou un proxy), par opposition au réseau local.
function requeteDistante(req) {
  return viaProxyLocal(req)
    && Boolean(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
}

function cookieSession(req, jeton, duree) {
  const securise = viaProxyLocal(req) && req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `formation_session=${jeton}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(duree / 1000)}${securise}`;
}

// ---------- HTTP ----------

function envoyer(res, statut, corps, entetes = {}) {
  const json = typeof corps !== 'string';
  res.writeHead(statut, {
    ...ENTETES_SECURITE,
    'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...entetes,
  });
  res.end(json ? JSON.stringify(corps) : corps);
}

class ErreurHttp extends Error {
  constructor(statut, message, details) { super(message); this.statut = statut; this.details = details; }
}

function lireCorps(req, limite) {
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

async function lireJson(req) {
  try {
    return JSON.parse((await lireCorps(req, TAILLE_JSON)).toString('utf8'));
  } catch (e) {
    if (e instanceof ErreurHttp) throw e;
    throw new ErreurHttp(400, 'Contenu JSON invalide.');
  }
}

function typeImage(octets) {
  const debut = octets.subarray(0, 12);
  if (debut.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (debut[0] === 0xff && debut[1] === 0xd8 && debut[2] === 0xff) return 'jpg';
  if (debut.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (debut.subarray(0, 4).toString('latin1') === 'RIFF' && debut.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

async function servirFichier(res, chemin, cache = 'no-cache') {
  try {
    const infos = await stat(chemin);
    if (!infos.isFile()) return false;
    res.writeHead(200, {
      ...ENTETES_SECURITE,
      'Content-Type': TYPES[extname(chemin).toLowerCase()] || 'application/octet-stream',
      'Content-Length': infos.size,
      'Cache-Control': cache,
    });
    createReadStream(chemin).pipe(res);
    return true;
  } catch {
    return false;
  }
}

async function servirStatique(res, chemin) {
  let relatif;
  try { relatif = decodeURIComponent(chemin); } catch { return false; }
  let cible = resolve(PUBLIC, `.${relatif}`);
  if (cible !== PUBLIC && !cible.startsWith(PUBLIC + sep)) return false;
  if (relatif.endsWith('/')) cible = join(cible, 'index.html');
  return servirFichier(res, cible);
}

// ---------- Routes ----------

function exigerAdmin(req) {
  if (!estConnecte(req)) throw new ErreurHttp(401, 'Connexion requise.');
  // Défense CSRF en plus de SameSite=Strict : les écritures viennent de notre propre script.
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'formation') {
    throw new ErreurHttp(403, 'Requête refusée.');
  }
}

async function routerApi(req, res, chemin) {
  const m = (motif) => chemin.match(motif);
  let p;

  // Public
  if (req.method === 'GET' && chemin === '/api/formations') {
    return envoyer(res, 200, (await listerFormations()).filter((f) => f.publie).map(resumer));
  }
  if (req.method === 'GET' && (p = m(/^\/api\/formations\/([^/]+)$/))) {
    const f = await lireFormation(p[1]);
    if (!f || (!f.publie && !estConnecte(req))) throw new ErreurHttp(404, 'Formation introuvable.');
    return envoyer(res, 200, f);
  }

  // Connexion
  if (req.method === 'GET' && chemin === '/api/admin/session') {
    return envoyer(res, 200, { connecte: estConnecte(req), active: await backOfficeActif() });
  }
  if (req.method === 'POST' && chemin === '/api/admin/connexion') {
    if (!(await backOfficeActif())) throw new ErreurHttp(503, 'Back-office désactivé : définir FORMATION_MOT_DE_PASSE sur le serveur.');
    // Le mot de passe de secours (variable d'environnement) ne vaut que sur le réseau local :
    // depuis Internet, il faut celui que l'administrateur a choisi dans le back-office.
    if (requeteDistante(req) && !(await lireAdmin())) {
      throw new ErreurHttp(403, 'Depuis Internet, connectez-vous avec le mot de passe choisi dans le back-office. Changez-le d\'abord depuis le réseau local (écran « Mot de passe »).');
    }
    verifierLimite(req);
    const { motDePasse } = await lireJson(req);
    if (!(await motDePasseCorrect(motDePasse))) {
      noterEchec(req);
      throw new ErreurHttp(401, 'Mot de passe incorrect.');
    }
    echecs.delete(adresseClient(req));
    const jeton = randomBytes(32).toString('hex');
    sessions.set(jeton, Date.now() + DUREE_SESSION);
    return envoyer(res, 200, { connecte: true }, { 'Set-Cookie': cookieSession(req, jeton, DUREE_SESSION) });
  }
  if (req.method === 'POST' && chemin === '/api/admin/deconnexion') {
    const jeton = lireCookie(req, 'formation_session');
    if (jeton) sessions.delete(jeton);
    return envoyer(res, 200, { connecte: false }, { 'Set-Cookie': cookieSession(req, '', 0) });
  }

  // Back-office
  if (chemin.startsWith('/api/admin/')) {
    exigerAdmin(req);

    if (req.method === 'POST' && chemin === '/api/admin/mot-de-passe') {
      verifierLimite(req);
      const { actuel, nouveau } = await lireJson(req);
      if (!(await motDePasseCorrect(actuel))) {
        noterEchec(req);
        throw new ErreurHttp(403, 'Mot de passe actuel incorrect.');
      }
      const manquantes = reglesNonRespectees(nouveau);
      if (actuel === nouveau) manquantes.push('Différent du mot de passe actuel');
      if (manquantes.length) throw new ErreurHttp(422, 'Le nouveau mot de passe ne respecte pas les règles.', { regles: manquantes });
      await enregistrerMotDePasse(nouveau);
      // Toutes les autres sessions sont fermées ; celle-ci reste ouverte.
      const jeton = lireCookie(req, 'formation_session');
      for (const autre of sessions.keys()) if (autre !== jeton) sessions.delete(autre);
      echecs.delete(adresseClient(req));
      return envoyer(res, 200, { change: true });
    }
    if (req.method === 'GET' && chemin === '/api/admin/formations') {
      return envoyer(res, 200, (await listerFormations()).map(resumer));
    }
    if (req.method === 'POST' && chemin === '/api/admin/formations') {
      const { titre } = await lireJson(req);
      if (typeof titre !== 'string' || !titre.trim()) throw new ErreurHttp(400, 'Titre requis.');
      const ids = (await listerFormations()).map((f) => f.id);
      const formation = normaliserFormation({
        id: idUnique(titre, ids), titre: titre.trim(), niveaux: [], publie: false,
        modifieLe: new Date().toISOString(),
      });
      await ecrireFormation(formation);
      return envoyer(res, 201, formation);
    }
    if ((p = m(/^\/api\/admin\/formations\/([^/]+)$/))) {
      const id = p[1];
      const actuelle = await lireFormation(id);
      if (!actuelle) throw new ErreurHttp(404, 'Formation introuvable.');

      if (req.method === 'GET') return envoyer(res, 200, actuelle);
      if (req.method === 'PUT') {
        const formation = normaliserFormation({ ...(await lireJson(req)), id, modifieLe: new Date().toISOString() });
        const bilan = verifierFormation(formation);
        if (formation.publie && bilan.erreurs.length) {
          throw new ErreurHttp(422, 'Publication impossible : corriger les erreurs signalées.', bilan);
        }
        await ecrireFormation(formation);
        return envoyer(res, 200, { formation, ...bilan });
      }
      if (req.method === 'DELETE') {
        await rename(cheminFormation(id), join(DOSSIERS.corbeille, `${id}-${Date.now()}.json`));
        return envoyer(res, 200, { supprime: id });
      }
    }
    if (req.method === 'POST' && chemin === '/api/admin/medias') {
      const octets = await lireCorps(req, TAILLE_IMAGE);
      const type = typeImage(octets);
      if (!type) throw new ErreurHttp(415, 'Format refusé : PNG, JPEG, WebP ou GIF uniquement.');
      let nomOrigine = String(req.headers['x-nom-fichier'] || 'image');
      try { nomOrigine = decodeURIComponent(nomOrigine); } catch { /* nom brut */ }
      const base = slug(nomOrigine.replace(/\.[^.]*$/, '')).slice(0, 40);
      const nom = `${base}-${randomBytes(3).toString('hex')}.${type}`;
      await writeFile(join(DOSSIERS.medias, nom), octets);
      return envoyer(res, 201, { url: `medias/${nom}` });
    }
  }

  throw new ErreurHttp(404, 'Route inconnue.');
}

async function gerer(req, res) {
  const url = new URL(req.url, 'http://local');
  const chemin = url.pathname;
  try {
    if (chemin.startsWith('/api/')) return await routerApi(req, res, chemin);

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErreurHttp(405, 'Méthode non permise.');

    // Les leçons référencent « medias/… » : à résoudre depuis le site comme depuis le back-office.
    const media = chemin.match(/^\/(?:admin\/)?medias\/([a-z0-9-]+\.(?:png|jpe?g|webp|gif))$/);
    if (media) {
      if (await servirFichier(res, join(DOSSIERS.medias, media[1]), 'public, max-age=31536000, immutable')) return;
      throw new ErreurHttp(404, 'Image introuvable.');
    }
    if (chemin === '/admin') return envoyer(res, 301, '', { Location: 'admin/' });
    if (await servirStatique(res, chemin)) return;
    throw new ErreurHttp(404, 'Page introuvable.');
  } catch (e) {
    if (e instanceof ErreurHttp) return envoyer(res, e.statut, { erreur: e.message, ...e.details });
    console.error(e);
    return envoyer(res, 500, { erreur: 'Erreur interne du serveur.' });
  }
}

await preparerDonnees();
http.createServer(gerer).listen(PORT, HOTE, () => {
  console.log(`Formation AKASHA : http://${HOTE}:${PORT}/  (données : ${DONNEES})`);
  backOfficeActif().then((actif) => { if (!actif) console.warn('⚠ Aucun mot de passe défini : back-office fermé.'); });
});
