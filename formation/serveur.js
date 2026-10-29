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
//   Boutique (offres, paiements, comptes stagiaires) : voir lib/boutique.js.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, rename, mkdir, readdir, stat, copyFile, unlink } from 'node:fs/promises';
import { join, extname, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { ENTETES_SECURITE, ErreurHttp, envoyer, lireCorps, lireJson, lireCookie } from './lib/http.js';
import { creerBoutique } from './lib/boutique.js';
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
const TAILLE_IMAGE = 8 * 1024 * 1024;
const VERSIONS_GARDEES = 30;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
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
    publie: f.publie, acces: f.acces, modifieLe: f.modifieLe, nbNiveaux: f.niveaux.length,
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
// Accès limité de l'organisatrice (Maât Soby) : boutique seulement, ni formations ni facturation.
const FICHIER_ORGANISATRICE = join(DONNEES, 'organisatrice.json');
const LIMITE_ESSAIS = 5;
const FENETRE_ESSAIS = 15 * 60 * 1000;

function empreinte(texte) {
  return createHash('sha256').update(String(texte)).digest();
}

async function lireCompte(fichier) {
  try {
    const compte = JSON.parse(await readFile(fichier, 'utf8'));
    return compte?.algo === 'scrypt' && compte.sel && compte.empreinte ? compte : null;
  } catch {
    return null;
  }
}

async function empreinteCorrecte(compte, propose) {
  if (!compte || typeof propose !== 'string' || !propose) return false;
  const calcule = await scryptAsync(propose, Buffer.from(compte.sel, 'hex'), 64);
  return timingSafeEqual(calcule, Buffer.from(compte.empreinte, 'hex'));
}

async function ecrireCompte(fichier, motDePasse, extra = {}) {
  const sel = randomBytes(16);
  const calcule = await scryptAsync(motDePasse, sel, 64);
  const contenu = { ...extra, algo: 'scrypt', sel: sel.toString('hex'), empreinte: calcule.toString('hex'), modifieLe: new Date().toISOString() };
  const temporaire = `${fichier}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporaire, `${JSON.stringify(contenu, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaire, fichier);
}

// Le mot de passe choisi dans le back-office (empreinte scrypt) prime sur celui de l'environnement.
const lireAdmin = () => lireCompte(FICHIER_ADMIN);
const lireOrganisatrice = () => lireCompte(FICHIER_ORGANISATRICE);

async function backOfficeActif() {
  return Boolean(MOT_DE_PASSE) || Boolean(await lireAdmin());
}

async function motDePasseCorrect(propose) {
  if (typeof propose !== 'string' || !propose) return false;
  const admin = await lireAdmin();
  if (admin) return empreinteCorrecte(admin, propose);
  if (!MOT_DE_PASSE) return false;
  return timingSafeEqual(empreinte(propose), empreinte(MOT_DE_PASSE));
}

const enregistrerMotDePasse = (nouveau) => ecrireCompte(FICHIER_ADMIN, nouveau);

// Mot de passe provisoire de l'organisatrice : lettres et chiffres lisibles (ni 0/O ni 1/l/I).
function motDePasseProvisoire() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const octets = randomBytes(15);
  const brut = [...octets].map((o) => alphabet[o % alphabet.length]).join('');
  return `${brut.slice(0, 5)}-${brut.slice(5, 10)}-${brut.slice(10)}`;
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

// Rôle de la session : « admin » (la plateforme) ou « organisatrice » ; null si personne n'est connecté.
function roleDe(req) {
  const jeton = lireCookie(req, 'formation_session');
  const session = jeton && sessions.get(jeton);
  if (!session) return null;
  if (session.fin < Date.now()) { sessions.delete(jeton); return null; }
  return session.role;
}
const estConnecte = (req) => Boolean(roleDe(req));

function ouvrirSessionBackOffice(req, role) {
  const jeton = randomBytes(32).toString('hex');
  sessions.set(jeton, { fin: Date.now() + DUREE_SESSION, role });
  return cookieSession(req, jeton, DUREE_SESSION);
}

function fermerSessions(role, sauf) {
  for (const [jeton, session] of sessions) if (session.role === role && jeton !== sauf) sessions.delete(jeton);
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

// Ce que l'organisatrice peut faire : sa boutique (sauf la facturation de la plateforme), lire la liste
// des formations (pour les relier à une offre), envoyer des images, changer son mot de passe.
const PERMIS_ORGANISATRICE = [
  ['GET', /^\/api\/admin\/formations$/],
  ['POST', /^\/api\/admin\/medias$/],
  ['POST', /^\/api\/admin\/mot-de-passe$/],
  ['*', /^\/api\/admin\/boutique\/(?!facturation)/],
];

function exigerAdmin(req) {
  const role = roleDe(req);
  if (!role) throw new ErreurHttp(401, 'Connexion requise.');
  // Défense CSRF en plus de SameSite=Strict : les écritures viennent de notre propre script.
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'formation') {
    throw new ErreurHttp(403, 'Requête refusée.');
  }
  if (role === 'organisatrice') {
    const chemin = new URL(req.url, 'http://local').pathname;
    if (!PERMIS_ORGANISATRICE.some(([methode, motif]) => (methode === '*' || methode === req.method) && motif.test(chemin))) {
      throw new ErreurHttp(403, 'Réservé à l\'administrateur de la plateforme.');
    }
  }
  return role;
}

// Une formation « réservée » s'ouvre aux stagiaires inscrits à une offre qui la contient.
async function peutSuivre(req, f) {
  return f.acces !== 'reserve' || estConnecte(req) || (await boutique.formationsAccessibles(req)).has(f.id);
}

async function routerApi(req, res, chemin, url) {
  const m = (motif) => chemin.match(motif);
  let p;

  // Public
  if (req.method === 'GET' && chemin === '/api/formations') {
    const publiees = (await listerFormations()).filter((f) => f.publie);
    return envoyer(res, 200, await Promise.all(publiees.map(async (f) => ({ ...resumer(f), accessible: await peutSuivre(req, f) }))));
  }
  if (req.method === 'GET' && (p = m(/^\/api\/formations\/([^/]+)$/))) {
    const f = await lireFormation(p[1]);
    if (!f || (!f.publie && !estConnecte(req))) throw new ErreurHttp(404, 'Formation introuvable.');
    if (!(await peutSuivre(req, f))) throw new ErreurHttp(403, 'Formation réservée aux inscrits.', { reserve: true });
    return envoyer(res, 200, f);
  }

  // Boutique : offres, paiements, espace des stagiaires (et son back-office)
  if (await boutique.router(req, res, chemin, url)) return;

  // Connexion
  if (req.method === 'GET' && chemin === '/api/admin/session') {
    const role = roleDe(req);
    const organisatrice = role === 'organisatrice' ? await lireOrganisatrice() : null;
    return envoyer(res, 200, { connecte: Boolean(role), role, nom: organisatrice?.nom || '', active: await backOfficeActif() });
  }
  if (req.method === 'POST' && chemin === '/api/admin/connexion') {
    if (!(await backOfficeActif())) throw new ErreurHttp(503, 'Back-office désactivé : définir FORMATION_MOT_DE_PASSE sur le serveur.');
    verifierLimite(req);
    const { motDePasse } = await lireJson(req);
    let role = null;
    if (await empreinteCorrecte(await lireOrganisatrice(), motDePasse)) role = 'organisatrice';
    else if (requeteDistante(req) && !(await lireAdmin())) {
      // Le mot de passe de secours (variable d'environnement) ne vaut que sur le réseau local :
      // depuis Internet, il faut celui que l'administrateur a choisi dans le back-office.
      throw new ErreurHttp(403, 'Depuis Internet, connectez-vous avec le mot de passe choisi dans le back-office. Changez-le d\'abord depuis le réseau local (écran « Mot de passe »).');
    } else if (await motDePasseCorrect(motDePasse)) role = 'admin';
    if (!role) {
      noterEchec(req);
      throw new ErreurHttp(401, 'Mot de passe incorrect.');
    }
    echecs.delete(adresseClient(req));
    return envoyer(res, 200, { connecte: true, role }, { 'Set-Cookie': ouvrirSessionBackOffice(req, role) });
  }
  if (req.method === 'POST' && chemin === '/api/admin/deconnexion') {
    const jeton = lireCookie(req, 'formation_session');
    if (jeton) sessions.delete(jeton);
    return envoyer(res, 200, { connecte: false }, { 'Set-Cookie': cookieSession(req, '', 0) });
  }

  // Back-office
  if (chemin.startsWith('/api/admin/')) {
    const role = exigerAdmin(req);

    if (req.method === 'POST' && chemin === '/api/admin/mot-de-passe') {
      verifierLimite(req);
      const { actuel, nouveau } = await lireJson(req);
      const organisatrice = role === 'organisatrice' ? await lireOrganisatrice() : null;
      const correct = role === 'organisatrice' ? await empreinteCorrecte(organisatrice, actuel) : await motDePasseCorrect(actuel);
      if (!correct) {
        noterEchec(req);
        throw new ErreurHttp(403, 'Mot de passe actuel incorrect.');
      }
      const manquantes = reglesNonRespectees(nouveau);
      if (actuel === nouveau) manquantes.push('Différent du mot de passe actuel');
      if (manquantes.length) throw new ErreurHttp(422, 'Le nouveau mot de passe ne respecte pas les règles.', { regles: manquantes });
      if (role === 'organisatrice') await ecrireCompte(FICHIER_ORGANISATRICE, nouveau, { nom: organisatrice.nom });
      else await enregistrerMotDePasse(nouveau);
      // Les autres sessions du même compte sont fermées ; celle-ci reste ouverte.
      fermerSessions(role, lireCookie(req, 'formation_session'));
      echecs.delete(adresseClient(req));
      return envoyer(res, 200, { change: true });
    }

    // Accès de l'organisatrice : créé, renouvelé ou retiré par l'administrateur.
    if (chemin === '/api/admin/organisatrice') {
      if (req.method === 'GET') {
        const o = await lireOrganisatrice();
        return envoyer(res, 200, { existe: Boolean(o), nom: o?.nom || '', modifieLe: o?.modifieLe || '' });
      }
      if (req.method === 'POST') {
        const { nom } = await lireJson(req);
        const provisoire = motDePasseProvisoire();
        await ecrireCompte(FICHIER_ORGANISATRICE, provisoire, { nom: typeof nom === 'string' && nom.trim() ? nom.trim().slice(0, 80) : 'Maât Soby' });
        fermerSessions('organisatrice');
        // Affiché une seule fois : il n'est gardé que sous forme d'empreinte.
        return envoyer(res, 200, { motDePasse: provisoire });
      }
      if (req.method === 'DELETE') {
        await unlink(FICHIER_ORGANISATRICE).catch((e) => { if (e.code !== 'ENOENT') throw e; });
        fermerSessions('organisatrice');
        return envoyer(res, 200, { retire: true });
      }
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
    if (chemin.startsWith('/api/')) return await routerApi(req, res, chemin, url);

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErreurHttp(405, 'Méthode non permise.');

    // Les leçons référencent « medias/… » : à résoudre depuis le site comme depuis le back-office.
    const media = chemin.match(/^\/(?:admin\/)?medias\/([a-z0-9-]+\.(?:png|jpe?g|webp|gif))$/);
    if (media) {
      if (await servirFichier(res, join(DOSSIERS.medias, media[1]), 'public, max-age=31536000, immutable')) return;
      throw new ErreurHttp(404, 'Image introuvable.');
    }
    if (chemin === '/admin' || chemin === '/boutique') return envoyer(res, 301, '', { Location: `${chemin.slice(1)}/` });
    if (await servirStatique(res, chemin)) return;
    throw new ErreurHttp(404, 'Page introuvable.');
  } catch (e) {
    if (e instanceof ErreurHttp) return envoyer(res, e.statut, { erreur: e.message, ...e.details });
    console.error(e);
    return envoyer(res, 500, { erreur: 'Erreur interne du serveur.' });
  }
}

const boutique = creerBoutique({
  donnees: DONNEES, port: PORT, exigerAdmin, adresseClient, viaProxyLocal, lireFormation, listerFormations,
  cookieSecurise: (req) => viaProxyLocal(req) && req.headers['x-forwarded-proto'] === 'https',
});

await preparerDonnees();
boutique.demarrer();
http.createServer(gerer).listen(PORT, HOTE, () => {
  console.log(`Formation AKASHA : http://${HOTE}:${PORT}/  (données : ${DONNEES})`);
  backOfficeActif().then((actif) => { if (!actif) console.warn('⚠ Aucun mot de passe défini : back-office fermé.'); });
});
