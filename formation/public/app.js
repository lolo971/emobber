// Site apprenant : catalogue → chemin de niveaux → leçon en cartes → quiz → résultat.
// Le niveau suivant se débloque quand le quiz atteint le seuil de la formation.

import { decouperEtapes } from './commun/nettoyer.js';
import { SEUIL_DEFAUT } from './commun/valider.js';

const app = document.getElementById('app');
const toast = document.getElementById('toast');
const formations = new Map();

// ---------- Outils DOM ----------

function el(tag, attributs = {}, ...enfants) {
  const noeud = document.createElement(tag);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (valeur === false || valeur == null) continue;
    if (cle.startsWith('on')) noeud.addEventListener(cle.slice(2), valeur);
    else if (cle === 'html') noeud.innerHTML = valeur;
    else noeud.setAttribute(cle, valeur === true ? '' : valeur);
  }
  for (const enfant of enfants.flat(Infinity)) {
    if (enfant == null || enfant === false || enfant === '') continue;
    noeud.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return noeud;
}

function afficher(...noeuds) {
  app.replaceChildren(...noeuds.flat().filter(Boolean));
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

let minuteurToast;
let garderAnnonce = false;
function annoncer(message, { garder = false } = {}) {
  garderAnnonce = garder;
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => toast.classList.remove('visible'), 2600);
}

function vibrer(motif) {
  if (navigator.vibrate) navigator.vibrate(motif);
}

function melanger(liste) {
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

async function api(chemin) {
  const reponse = await fetch(chemin, { cache: 'no-cache' });
  if (!reponse.ok) throw new Error(reponse.status === 404 ? 'Cette formation n\'existe pas ou n\'est pas publiée.' : 'Le serveur ne répond pas.');
  return reponse.json();
}

async function formation(id) {
  if (!formations.has(id)) formations.set(id, await api(`api/formations/${encodeURIComponent(id)}`));
  return formations.get(id);
}

// ---------- Mémoire de l'apprenant (navigateur) ----------

function lire(cle, defaut) {
  try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch { return defaut; }
}
function ecrire(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* navigation privée */ }
}

const cleProgression = (fid) => `akasha-formation:${fid}`;
const progression = (fid) => {
  const p = lire(cleProgression(fid), null);
  return p?.version === 2 ? p : { version: 2, niveaux: {}, questions: {} };
};

function joueur() {
  return lire('akasha-formation:joueur', { xp: 0, serie: { jours: 0, dernier: '' } });
}

const jour = (decalage = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  return d.toLocaleDateString('fr-CA');
};

function serieActuelle() {
  const { serie } = joueur();
  return serie.dernier === jour() || serie.dernier === jour(-1) ? serie.jours : 0;
}

function gagner(xp) {
  const j = joueur();
  j.xp += xp;
  if (j.serie.dernier !== jour()) {
    j.serie = { jours: j.serie.dernier === jour(-1) ? j.serie.jours + 1 : 1, dernier: jour() };
  }
  ecrire('akasha-formation:joueur', j);
}

const seuilDe = (f, n) => n.seuil ?? f.seuil ?? SEUIL_DEFAUT;
const etoilesPour = (score, seuil) => (score >= 100 ? 3 : score >= Math.max(90, seuil) ? 2 : score >= seuil ? 1 : 0);

function statutNiveau(f, p, index) {
  const n = f.niveaux[index];
  if (p.niveaux[n.id]?.reussi) return 'reussi';
  if (index === 0 || p.niveaux[f.niveaux[index - 1].id]?.reussi) return 'ouvert';
  return 'verrouille';
}

function niveauCourant(f, p) {
  const index = f.niveaux.findIndex((_, i) => statutNiveau(f, p, i) === 'ouvert');
  return index === -1 ? null : index;
}

// ---------- Éléments communs ----------

function compteurs() {
  return el('div', { class: 'compteurs' },
    el('span', { class: 'compteur', title: 'Jours d\'affilée' }, el('span', { 'aria-hidden': 'true' }, '🔥'), ` ${serieActuelle()}`,
      el('span', { class: 'sr' }, ' jours de série')),
    el('span', { class: 'compteur', title: 'Points d\'expérience' }, el('span', { 'aria-hidden': 'true' }, '✦'), ` ${joueur().xp}`,
      el('span', { class: 'sr' }, ' points')));
}

function barreHaut(retour, titre) {
  return el('header', { class: 'barre-haut' },
    retour ? el('a', { class: 'retour', href: retour, 'aria-label': 'Retour' }, '←') : el('span', { class: 'marque' }, 'AKASHA'),
    titre ? el('span', { class: 'barre-titre' }, titre) : el('span', { class: 'barre-titre etiquette' }, 'La bibliothèque vivante · Formation'),
    compteurs());
}

function jauge(valeur, total, libelle) {
  const pct = total ? Math.round((valeur / total) * 100) : 0;
  return el('div', { class: 'jauge', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': valeur, 'aria-label': libelle },
    el('span', { style: `width:${pct}%` }));
}

function etoiles(nombre, classe = '') {
  return el('span', { class: `etoiles ${classe}`, 'aria-label': `${nombre} étoile${nombre > 1 ? 's' : ''} sur 3` },
    [0, 1, 2].map((i) => el('span', { class: i < nombre ? 'pleine' : '', 'aria-hidden': 'true' }, '★')));
}

function erreur(message) {
  afficher(barreHaut('#/'), el('main', { class: 'page' }, el('p', { class: 'vide' }, message),
    el('a', { class: 'bouton secondaire', href: '#/' }, 'Retour aux formations')));
}

// ---------- Catalogue ----------

async function vueCatalogue() {
  const liste = await api('api/formations');
  const cartes = liste.map((f) => {
    const p = progression(f.id);
    const faits = f.niveaux.filter((id) => p.niveaux[id]?.reussi).length;
    return el('li', {}, el('a', { class: 'carte-formation', href: `#/f/${encodeURIComponent(f.id)}` },
      f.image ? el('img', { class: 'couverture', src: f.image, alt: '' }) : el('div', { class: 'couverture glyphe', 'aria-hidden': 'true' }, '✦'),
      el('div', { class: 'carte-corps' },
        el('h2', {}, f.titre),
        f.sousTitre && el('p', { class: 'sous-titre' }, f.sousTitre),
        jauge(faits, f.nbNiveaux, `Progression dans ${f.titre}`),
        el('p', { class: 'etiquette' }, faits === f.nbNiveaux && faits > 0 ? '✓ Terminée' : `${faits} / ${f.nbNiveaux} niveaux`))));
  });

  afficher(
    barreHaut(),
    el('main', { class: 'page' },
      el('h1', { class: 'titre-page' }, 'Formations'),
      el('p', { class: 'devise' }, 'Relier sans confondre. Explorer sans imposer. Comprendre avant d\'interpréter.'),
      cartes.length ? el('ul', { class: 'catalogue' }, cartes) : el('p', { class: 'vide' }, 'Aucune formation publiée pour le moment.')));
}

// ---------- Parcours d'une formation ----------

async function vueFormation(fid) {
  const f = await formation(fid);
  const p = progression(fid);
  const faits = f.niveaux.filter((n) => p.niveaux[n.id]?.reussi).length;
  const courant = niveauCourant(f, p);
  const aReviser = f.niveaux.some((n) => p.niveaux[n.id]?.reussi);

  const chemin = f.niveaux.map((n, i) => {
    const statut = statutNiveau(f, p, i);
    const info = p.niveaux[n.id];
    const medaillon = el('span', { class: 'medaillon', 'aria-hidden': 'true' },
      statut === 'reussi' ? '✓' : statut === 'verrouille' ? '🔒' : i + 1);
    const libelle = el('span', { class: 'etape-texte' },
      el('span', { class: 'etiquette' }, `Niveau ${i + 1}`),
      el('span', { class: 'etape-titre' }, n.titre),
      info?.etoiles ? etoiles(info.etoiles) : n.resume && el('span', { class: 'etape-resume' }, n.resume));
    const classes = `etape ${statut} ${i === courant ? 'courant' : ''} ${i % 2 ? 'droite' : 'gauche'}`;
    return el('li', { class: classes },
      statut === 'verrouille'
        ? el('button', { type: 'button', class: 'etape-lien', 'aria-disabled': 'true',
          onclick: () => annoncer(`Réussissez le niveau ${i} pour ouvrir celui-ci.`) }, medaillon, libelle)
        : el('a', { class: 'etape-lien', href: `#/f/${fid}/n/${n.id}` }, medaillon, libelle));
  });

  afficher(
    barreHaut('#/', f.titre),
    el('main', { class: 'page' },
      el('section', { class: 'entete-formation' },
        f.image && el('img', { class: 'banniere', src: f.image, alt: '' }),
        el('h1', {}, f.titre),
        f.sousTitre && el('p', { class: 'sous-titre' }, f.sousTitre),
        f.description && el('p', { class: 'description' }, f.description),
        el('div', { class: 'ligne-progression' },
          jauge(faits, f.niveaux.length, 'Progression'),
          el('span', { class: 'etiquette' }, `${faits} / ${f.niveaux.length}`)),
        el('div', { class: 'actions' },
          courant !== null
            ? el('a', { class: 'bouton', href: `#/f/${fid}/n/${f.niveaux[courant].id}` },
              faits ? `Continuer · niveau ${courant + 1}` : 'Commencer')
            : el('p', { class: 'termine' }, '✦ Formation terminée — bravo.'),
          aReviser && el('a', { class: 'bouton secondaire', href: `#/f/${fid}/revision` }, 'Réviser'))),
      el('ol', { class: 'chemin' }, chemin)));
}

// ---------- Leçon en cartes ----------

async function vueLecon(fid, nid, numeroEtape) {
  const f = await formation(fid);
  const index = f.niveaux.findIndex((n) => n.id === nid);
  if (index === -1) return erreur('Niveau introuvable.');
  if (statutNiveau(f, progression(fid), index) === 'verrouille') {
    annoncer(`Réussissez d'abord le niveau ${index}.`, { garder: true });
    location.replace(`#/f/${fid}`);
    return;
  }
  const n = f.niveaux[index];
  const etapes = decouperEtapes(n.lecon);
  const e = Math.min(Math.max(numeroEtape, 0), etapes.length - 1);
  const derniere = e === etapes.length - 1;
  const total = etapes.length + 1; // + le quiz

  afficher(
    el('header', { class: 'barre-immersive' },
      el('a', { class: 'fermer', href: `#/f/${fid}`, 'aria-label': 'Quitter la leçon' }, '✕'),
      jauge(e + 1, total, 'Avancement dans le niveau'),
      el('span', { class: 'etiquette' }, `${e + 1}/${total}`)),
    el('main', { class: 'page immersive' },
      el('p', { class: 'etiquette' }, `Niveau ${index + 1} · Leçon`),
      e === 0 && el('h1', { class: 'titre-lecon' }, n.titre),
      el('article', { class: 'carte-lecon contenu-lecon', html: etapes[e] || '<p>Cette leçon est vide.</p>' })),
    el('footer', { class: 'barre-action' },
      e > 0 && el('a', { class: 'bouton discret', href: `#/f/${fid}/n/${nid}/${e - 1}` }, 'Précédent'),
      el('a', { class: 'bouton large', href: derniere ? `#/f/${fid}/n/${nid}/quiz` : `#/f/${fid}/n/${nid}/${e + 1}` },
        derniere ? 'Passer au quiz' : 'Continuer')));
}

// ---------- Quiz : une question par écran ----------

function lancerQuiz({ questions, retour, entete, terminer }) {
  const resultats = [];
  let i = 0;

  function question() {
    const { q } = questions[i];
    const multiple = q.bonnes.length > 1;
    const ordre = melanger(q.choix.map((_, c) => c));
    const choisis = new Set();
    let verifie = false;

    const verifier = el('button', { type: 'button', class: 'bouton large', disabled: true, onclick: () => (verifie ? suivante() : corriger()) }, 'Vérifier');
    const tuiles = ordre.map((c) => el('button', {
      type: 'button', class: 'choix', 'aria-pressed': 'false', 'data-choix': c,
      onclick: (ev) => {
        if (verifie) return;
        if (!multiple) {
          choisis.clear();
          tuiles.forEach((t) => t.setAttribute('aria-pressed', 'false'));
        }
        if (choisis.has(c)) choisis.delete(c); else choisis.add(c);
        ev.currentTarget.setAttribute('aria-pressed', String(choisis.has(c)));
        verifier.disabled = choisis.size === 0;
      },
    }, el('span', { class: 'puce', 'aria-hidden': 'true' }), el('span', {}, q.choix[c])));
    const retourCorrection = el('div', { class: 'correction', 'aria-live': 'assertive' });

    function corriger() {
      verifie = true;
      const reponse = [...choisis];
      const juste = reponse.length === q.bonnes.length && reponse.every((c) => q.bonnes.includes(c));
      resultats.push({ ...questions[i], juste });
      tuiles.forEach((t) => {
        const c = Number(t.dataset.choix);
        t.disabled = true;
        if (q.bonnes.includes(c)) t.classList.add('bonne');
        else if (choisis.has(c)) t.classList.add('fausse');
      });
      vibrer(juste ? 30 : [60, 40, 60]);
      retourCorrection.className = `correction visible ${juste ? 'juste' : 'faux'}`;
      retourCorrection.replaceChildren(
        el('p', { class: 'verdict' }, juste ? '✦ Juste !' : 'Pas tout à fait.'),
        !juste && el('p', { class: 'bonne-reponse' }, `Réponse : ${q.bonnes.map((b) => q.choix[b]).join(' · ')}`),
        q.explication && el('p', { class: 'explication' }, q.explication));
      verifier.textContent = i === questions.length - 1 ? 'Voir le résultat' : 'Continuer';
      verifier.classList.toggle('juste', juste);
      verifier.focus();
    }

    function suivante() {
      i += 1;
      if (i < questions.length) question(); else terminer(resultats);
    }

    afficher(
      el('header', { class: 'barre-immersive' },
        el('a', { class: 'fermer', href: retour, 'aria-label': 'Quitter le quiz' }, '✕'),
        jauge(i, questions.length, 'Avancement du quiz'),
        el('span', { class: 'etiquette' }, `${i + 1}/${questions.length}`)),
      el('main', { class: 'page immersive' },
        el('p', { class: 'etiquette' }, entete),
        el('h1', { class: 'enonce' }, q.enonce),
        q.image && el('img', { class: 'image-question', src: q.image, alt: '' }),
        el('p', { class: 'consigne' }, multiple ? 'Plusieurs réponses possibles.' : 'Une seule réponse.'),
        el('div', { class: 'choix-liste', role: 'group', 'aria-label': 'Choix de réponse' }, tuiles)),
      el('footer', { class: 'barre-action colonne' }, retourCorrection, verifier));
  }

  question();
}

async function vueQuiz(fid, nid) {
  const f = await formation(fid);
  const index = f.niveaux.findIndex((n) => n.id === nid);
  if (index === -1) return erreur('Niveau introuvable.');
  if (statutNiveau(f, progression(fid), index) === 'verrouille') { location.replace(`#/f/${fid}`); return; }
  const n = f.niveaux[index];
  if (!n.questions.length) return erreur('Ce niveau n\'a pas encore de quiz.');

  lancerQuiz({
    questions: n.questions.map((q) => ({ q, nid })),
    retour: `#/f/${fid}`,
    entete: `Niveau ${index + 1} · Quiz`,
    terminer: (resultats) => finirNiveau(f, index, resultats),
  });
}

function memoriserReponses(p, resultats) {
  for (const { q, nid, juste } of resultats) {
    const cle = `${nid}/${q.id}`;
    const m = p.questions[cle] || { vues: 0, ratees: 0 };
    p.questions[cle] = { vues: m.vues + 1, ratees: juste ? Math.max(0, m.ratees - 1) : m.ratees + 1 };
  }
}

function finirNiveau(f, index, resultats) {
  const n = f.niveaux[index];
  const p = progression(f.id);
  const justes = resultats.filter((r) => r.juste).length;
  const score = Math.round((justes / resultats.length) * 100);
  const seuil = seuilDe(f, n);
  const reussi = score >= seuil;
  const avant = p.niveaux[n.id] || { tentatives: 0, meilleurScore: 0, reussi: false, etoiles: 0 };
  const premiereReussite = reussi && !avant.reussi;

  p.niveaux[n.id] = {
    tentatives: avant.tentatives + 1,
    meilleurScore: Math.max(avant.meilleurScore, score),
    reussi: avant.reussi || reussi,
    etoiles: Math.max(avant.etoiles || 0, etoilesPour(score, seuil)),
  };
  memoriserReponses(p, resultats);
  ecrire(cleProgression(f.id), p);
  const xp = justes * 10 + (premiereReussite ? 30 : 0);
  gagner(xp);

  const suivant = f.niveaux[index + 1];
  ecranResultat({
    score, justes, total: resultats.length, xp, reussi,
    etoiles: etoilesPour(score, seuil),
    titre: reussi ? (suivant ? 'Niveau réussi' : 'Formation terminée') : 'Encore un effort',
    message: reussi
      ? (suivant ? (premiereReussite ? `Le niveau ${index + 2} est débloqué.` : 'Nouveau passage réussi.') : 'Vous avez franchi tous les niveaux.')
      : `Il faut ${seuil} % pour ouvrir la suite. Relisez la leçon, puis retentez.`,
    actions: [
      reussi && suivant && el('a', { class: 'bouton large', href: `#/f/${f.id}/n/${suivant.id}` }, `Niveau ${index + 2} →`),
      !reussi && el('a', { class: 'bouton large', href: `#/f/${f.id}/n/${n.id}` }, 'Relire la leçon'),
      el('button', { type: 'button', class: 'bouton secondaire large', onclick: () => vueQuiz(f.id, n.id) }, 'Refaire le quiz'),
      el('a', { class: 'bouton discret large', href: `#/f/${f.id}` }, 'Retour au parcours'),
    ],
  });
}

function ecranResultat({ score, justes, total, xp, reussi, etoiles: nb, titre, message, actions }) {
  afficher(
    el('main', { class: `page resultat ${reussi ? 'reussi' : 'echoue'}` },
      reussi && el('div', { class: 'eclats', 'aria-hidden': 'true' }, Array.from({ length: 18 }, (_, k) => el('span', { style: `--k:${k}` }))),
      el('p', { class: 'etiquette' }, reussi ? 'Réussite' : 'Résultat'),
      el('h1', {}, titre),
      el('div', { class: 'anneau', style: `--pct:${score}` }, el('span', {}, `${score}`, el('small', {}, '%'))),
      nb > 0 && etoiles(nb, 'grandes'),
      el('p', { class: 'detail' }, `${justes} bonne${justes > 1 ? 's' : ''} réponse${justes > 1 ? 's' : ''} sur ${total}`),
      xp > 0 && el('p', { class: 'gain' }, `+${xp} ✦`),
      el('p', { class: 'message' }, message),
      el('div', { class: 'actions colonne' }, actions)));
}

// ---------- Révision (questions ratées en priorité) ----------

async function vueRevision(fid) {
  const f = await formation(fid);
  const p = progression(fid);
  const candidates = f.niveaux
    .filter((n) => p.niveaux[n.id]?.reussi)
    .flatMap((n) => n.questions.map((q) => ({ q, nid: n.id, poids: p.questions[`${n.id}/${q.id}`]?.ratees || 0 })));
  if (!candidates.length) return erreur('Réussissez un premier niveau pour débloquer la révision.');

  const choisies = melanger(candidates).sort((a, b) => b.poids - a.poids).slice(0, 5);
  lancerQuiz({
    questions: choisies,
    retour: `#/f/${fid}`,
    entete: 'Révision',
    terminer: (resultats) => {
      const prog = progression(fid);
      memoriserReponses(prog, resultats);
      ecrire(cleProgression(fid), prog);
      const justes = resultats.filter((r) => r.juste).length;
      const xp = justes * 5;
      gagner(xp);
      ecranResultat({
        score: Math.round((justes / resultats.length) * 100), justes, total: resultats.length, xp,
        reussi: justes === resultats.length, etoiles: 0,
        titre: 'Révision terminée',
        message: justes === resultats.length ? 'Tout est en place.' : 'Les questions manquées reviendront en priorité.',
        actions: [
          el('a', { class: 'bouton large', href: `#/f/${fid}/revision`, onclick: () => setTimeout(router) }, 'Nouvelle révision'),
          el('a', { class: 'bouton discret large', href: `#/f/${fid}` }, 'Retour au parcours'),
        ],
      });
    },
  });
}

// ---------- Navigation ----------

function router() {
  // Un message émis juste avant une redirection doit survivre à ce seul changement d'écran.
  if (!garderAnnonce) toast.classList.remove('visible');
  garderAnnonce = false;
  const morceaux = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  let rendu;
  if (morceaux[0] === 'f' && morceaux[1]) {
    const [, fid, quoi, nid, suite] = morceaux;
    if (quoi === 'n' && nid) rendu = suite === 'quiz' ? vueQuiz(fid, nid) : vueLecon(fid, nid, Number(suite) || 0);
    else if (quoi === 'revision') rendu = vueRevision(fid);
    else rendu = vueFormation(fid);
  } else {
    rendu = vueCatalogue();
  }
  Promise.resolve(rendu).catch((e) => { console.error(e); erreur(e.message); });
}

window.addEventListener('hashchange', router);
router();
