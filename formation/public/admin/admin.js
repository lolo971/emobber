// Back-office : créer et éditer les formations, leurs leçons (texte + visuels) et leurs quiz.

import { nettoyerHtml, CLASSES_ENCADRE } from '../commun/nettoyer.js';
import { idUnique, verifierFormation, normaliserFormation } from '../commun/valider.js';

const app = document.getElementById('app');
const toast = document.getElementById('toast');

// État de l'éditeur
let formation = null;
let selection = 'parametres'; // 'parametres' ou index de niveau
let modifie = false;
let bilan = { erreurs: [], avertissements: [] };

// ---------- Outils ----------

function el(tag, attributs = {}, ...enfants) {
  const noeud = document.createElement(tag);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (valeur === false || valeur == null) continue;
    if (cle.startsWith('on')) noeud.addEventListener(cle.slice(2), valeur);
    else if (cle === 'html') noeud.innerHTML = valeur;
    else if (cle === 'value') noeud.value = valeur;
    else noeud.setAttribute(cle, valeur === true ? '' : valeur);
  }
  for (const enfant of enfants.flat(Infinity)) {
    if (enfant == null || enfant === false || enfant === '') continue;
    noeud.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return noeud;
}

let minuteur;
function annoncer(message, type = '') {
  toast.textContent = message;
  toast.className = `visible ${type}`;
  clearTimeout(minuteur);
  minuteur = setTimeout(() => { toast.className = ''; }, 3000);
}

async function api(methode, chemin, corps, entetes = {}) {
  const brut = corps instanceof Blob;
  const reponse = await fetch(`../api/${chemin}`, {
    method: methode,
    headers: {
      'X-Requested-With': 'formation',
      ...(corps && !brut ? { 'Content-Type': 'application/json' } : {}),
      ...entetes,
    },
    body: corps ? (brut ? corps : JSON.stringify(corps)) : undefined,
    credentials: 'same-origin',
  });
  const donnees = await reponse.json().catch(() => ({}));
  if (reponse.status === 401 && chemin !== 'admin/connexion') {
    vueConnexion();
    throw new Error('Session expirée : reconnectez-vous.');
  }
  if (!reponse.ok) {
    const e = new Error(donnees.erreur || `Erreur ${reponse.status}`);
    e.details = donnees;
    throw e;
  }
  return donnees;
}

function marquerModifie() {
  modifie = true;
  const etat = document.querySelector('.etat-enregistrement');
  if (etat) { etat.textContent = '● Non enregistré'; etat.className = 'etat-enregistrement sale'; }
}

window.addEventListener('beforeunload', (e) => {
  if (modifie) { e.preventDefault(); e.returnValue = ''; }
});

function champ(libelle, controle, aide) {
  return el('label', { class: 'champ' }, el('span', { class: 'etiquette' }, libelle), controle, aide && el('span', { class: 'aide' }, aide));
}

function texteLie(objet, cle, attributs = {}) {
  const multi = attributs.lignes;
  const controle = el(multi ? 'textarea' : 'input', {
    ...(multi ? { rows: attributs.lignes } : { type: 'text' }),
    value: objet[cle] ?? '', placeholder: attributs.placeholder, maxlength: attributs.max,
    oninput: (e) => {
      objet[cle] = e.target.value;
      marquerModifie();
      attributs.apres?.(e.target.value);
    },
  });
  return controle;
}

async function envoyerImage(fichier) {
  if (!fichier) return null;
  if (fichier.size > 8 * 1024 * 1024) { annoncer('Image trop lourde (8 Mo maximum).', 'erreur'); return null; }
  try {
    const { url } = await api('POST', 'admin/medias', fichier, { 'Content-Type': fichier.type || 'application/octet-stream', 'X-Nom-Fichier': encodeURIComponent(fichier.name) });
    return url;
  } catch (e) {
    annoncer(e.message, 'erreur');
    return null;
  }
}

function choisirImage() {
  return new Promise((ok) => {
    const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
    input.addEventListener('change', async () => ok(await envoyerImage(input.files[0])));
    input.click();
  });
}

function blocImage(objet, cle, libelle) {
  const zone = el('div', { class: 'bloc-image' });
  const rendre = () => zone.replaceChildren(
    objet[cle]
      ? el('img', { src: objet[cle], alt: '' })
      : el('div', { class: 'image-vide' }, 'Aucune image'),
    el('div', { class: 'boutons-ligne' },
      el('button', { type: 'button', class: 'bouton secondaire petit', onclick: async () => {
        const url = await choisirImage();
        if (url) { objet[cle] = url; marquerModifie(); rendre(); }
      } }, objet[cle] ? 'Remplacer' : 'Ajouter une image'),
      objet[cle] && el('button', { type: 'button', class: 'bouton discret petit', onclick: () => { objet[cle] = ''; marquerModifie(); rendre(); } }, 'Retirer')));
  rendre();
  return el('div', { class: 'champ' }, el('span', { class: 'etiquette' }, libelle), zone);
}

// ---------- Connexion ----------

async function vueConnexion() {
  const session = await api('GET', 'admin/session').catch(() => ({ active: true }));
  const message = el('p', { class: 'message-erreur', role: 'alert' });
  const motDePasse = el('input', { type: 'password', autocomplete: 'current-password', required: true, id: 'mdp' });
  app.replaceChildren(el('main', { class: 'connexion' },
    el('p', { class: 'marque' }, 'AKASHA'),
    el('h1', {}, 'Back-office de formation'),
    session.active === false
      ? el('p', { class: 'message-erreur' }, 'Le back-office est fermé : définissez FORMATION_MOT_DE_PASSE sur le serveur, puis redémarrez-le.')
      : el('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await api('POST', 'admin/connexion', { motDePasse: motDePasse.value });
            routeur();
          } catch (erreur) {
            message.textContent = erreur.message;
            motDePasse.select();
          }
        },
      }, champ('Mot de passe', motDePasse), message, el('button', { class: 'bouton large', type: 'submit' }, 'Entrer'))));
  motDePasse.focus();
}

// ---------- Liste des formations ----------

async function vueListe() {
  const liste = await api('GET', 'admin/formations');
  const date = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

  app.replaceChildren(
    enTete(el('span', { class: 'titre-barre' }, 'Formations')),
    el('main', { class: 'page-admin' },
      el('div', { class: 'titre-ligne' },
        el('h1', {}, 'Vos formations'),
        el('button', { type: 'button', class: 'bouton', onclick: creerFormation }, '+ Nouvelle formation')),
      liste.length === 0
        ? el('p', { class: 'vide' }, 'Aucune formation. Créez la première.')
        : el('ul', { class: 'liste-formations' }, liste.map((f) => el('li', { class: 'ligne-formation' },
          f.image ? el('img', { src: f.image, alt: '' }) : el('div', { class: 'vignette', 'aria-hidden': 'true' }, '✦'),
          el('div', { class: 'ligne-texte' },
            el('a', { href: `#/f/${f.id}`, class: 'ligne-titre' }, f.titre),
            el('span', { class: 'etiquette' },
              el('span', { class: `pastille ${f.publie ? 'publie' : ''}` }, f.publie ? 'Publiée' : 'Brouillon'),
              ` · ${f.nbNiveaux} niveau${f.nbNiveaux > 1 ? 'x' : ''} · modifiée le ${date(f.modifieLe)}`)),
          el('div', { class: 'boutons-ligne' },
            el('a', { class: 'bouton secondaire petit', href: `#/f/${f.id}` }, 'Modifier'),
            el('a', { class: 'bouton discret petit', href: `../#/f/${f.id}`, target: '_blank', rel: 'noopener' }, 'Voir'),
            el('button', { type: 'button', class: 'bouton danger petit', onclick: () => supprimerFormation(f) }, 'Supprimer'))))),
    ));
}

async function creerFormation() {
  const titre = prompt('Titre de la nouvelle formation :');
  if (!titre?.trim()) return;
  try {
    const f = await api('POST', 'admin/formations', { titre });
    location.hash = `#/f/${f.id}`;
  } catch (e) { annoncer(e.message, 'erreur'); }
}

async function supprimerFormation(f) {
  if (!confirm(`Supprimer « ${f.titre} » ?\nElle sera déplacée dans la corbeille du serveur (récupérable).`)) return;
  try {
    await api('DELETE', `admin/formations/${f.id}`);
    annoncer('Formation déplacée dans la corbeille.');
    vueListe();
  } catch (e) { annoncer(e.message, 'erreur'); }
}

function enTete(...milieu) {
  return el('header', { class: 'barre-admin' },
    el('a', { class: 'marque', href: '#/' }, 'AKASHA'),
    ...milieu,
    el('button', { type: 'button', class: 'bouton discret petit', onclick: async () => {
      if (modifie && !confirm('Des modifications ne sont pas enregistrées. Se déconnecter quand même ?')) return;
      modifie = false;
      await api('POST', 'admin/deconnexion');
      vueConnexion();
    } }, 'Déconnexion'));
}

// ---------- Éditeur de formation ----------

async function vueEditeur(id) {
  formation = await api('GET', `admin/formations/${id}`);
  selection = 'parametres';
  modifie = false;
  bilan = verifierFormation(normaliserFormation(formation));
  rendreEditeur();
}

function rendreEditeur() {
  const etat = el('span', { class: `etat-enregistrement ${modifie ? 'sale' : ''}` }, modifie ? '● Non enregistré' : '✓ Enregistré');
  app.replaceChildren(
    enTete(
      el('a', { class: 'bouton discret petit', href: '#/', onclick: (e) => {
        if (modifie && !confirm('Quitter sans enregistrer ?')) e.preventDefault(); else modifie = false;
      } }, '← Formations'),
      el('span', { class: 'titre-barre' }, formation.titre || 'Sans titre'),
      etat,
      el('a', { class: 'bouton secondaire petit', href: `../#/f/${formation.id}`, target: '_blank', rel: 'noopener', title: 'Enregistrez d\'abord pour voir vos dernières modifications' }, 'Aperçu'),
      el('button', { type: 'button', class: 'bouton petit', onclick: enregistrer }, 'Enregistrer')),
    el('div', { class: 'editeur' },
      el('aside', { class: 'sommaire' }, sommaire()),
      el('main', { class: 'panneau' }, panneauBilan(), selection === 'parametres' ? panneauParametres() : panneauNiveau(selection))));
}

function sommaire() {
  const niveaux = formation.niveaux.map((n, i) => el('li', { class: `item-niveau ${selection === i ? 'actif' : ''}` },
    el('button', { type: 'button', class: 'item-lien', onclick: () => { selection = i; rendreEditeur(); } },
      el('span', { class: 'numero' }, i + 1),
      el('span', { class: 'item-titre' }, n.titre || 'Sans titre'),
      el('span', { class: 'item-meta' }, `${n.questions.length} q.`)),
    el('span', { class: 'item-actions' },
      el('button', { type: 'button', class: 'icone', title: 'Monter', 'aria-label': `Monter le niveau ${i + 1}`, disabled: i === 0, onclick: () => deplacerNiveau(i, -1) }, '↑'),
      el('button', { type: 'button', class: 'icone', title: 'Descendre', 'aria-label': `Descendre le niveau ${i + 1}`, disabled: i === formation.niveaux.length - 1, onclick: () => deplacerNiveau(i, 1) }, '↓'))));

  return [
    el('button', { type: 'button', class: `item-parametres ${selection === 'parametres' ? 'actif' : ''}`, onclick: () => { selection = 'parametres'; rendreEditeur(); } },
      '⚙ Paramètres de la formation'),
    el('p', { class: 'etiquette sommaire-titre' }, 'Niveaux'),
    el('ol', { class: 'liste-niveaux' }, niveaux),
    el('button', { type: 'button', class: 'bouton secondaire large', onclick: ajouterNiveau }, '+ Ajouter un niveau'),
  ];
}

function panneauBilan() {
  if (!bilan.erreurs.length && !bilan.avertissements.length) return null;
  return el('details', { class: 'bilan', open: bilan.erreurs.length > 0 },
    el('summary', {}, bilan.erreurs.length
      ? `${bilan.erreurs.length} point${bilan.erreurs.length > 1 ? 's' : ''} à corriger avant publication`
      : `${bilan.avertissements.length} suggestion${bilan.avertissements.length > 1 ? 's' : ''}`),
    el('ul', {},
      bilan.erreurs.map((e) => el('li', { class: 'bloquant' }, e)),
      bilan.avertissements.map((a) => el('li', {}, a))));
}

function panneauParametres() {
  const f = formation;
  return el('section', { class: 'carte-edition' },
    el('h1', {}, 'Paramètres'),
    champ('Titre', texteLie(f, 'titre', { max: 200, apres: (v) => { document.querySelector('.titre-barre').textContent = v || 'Sans titre'; } })),
    champ('Sous-titre', texteLie(f, 'sousTitre', { max: 300, placeholder: 'Une phrase qui donne envie' })),
    champ('Présentation', texteLie(f, 'description', { lignes: 4, max: 2000, placeholder: 'Ce que l\'apprenant va découvrir, pour qui, en combien de temps…' })),
    blocImage(f, 'image', 'Image de couverture'),
    el('div', { class: 'grille-2' },
      champ('Seuil de réussite (%)', el('input', { type: 'number', min: 0, max: 100, value: f.seuil, oninput: (e) => { f.seuil = Number(e.target.value); marquerModifie(); } }),
        'Score minimum au quiz pour débloquer le niveau suivant.'),
      el('label', { class: 'interrupteur' },
        el('input', { type: 'checkbox', checked: f.publie, onchange: (e) => { f.publie = e.target.checked; marquerModifie(); } }),
        el('span', {}, el('strong', {}, 'Publiée'), el('br'), el('span', { class: 'aide' }, 'Visible par les apprenants après enregistrement.')))),
    el('p', { class: 'aide' }, `Identifiant : ${f.id}`));
}

function ajouterNiveau() {
  const titre = prompt('Titre du nouveau niveau :');
  if (!titre?.trim()) return;
  formation.niveaux.push({
    id: idUnique(titre, formation.niveaux.map((n) => n.id)),
    titre: titre.trim(), resume: '', lecon: '<p><br></p>', questions: [],
  });
  selection = formation.niveaux.length - 1;
  marquerModifie();
  rendreEditeur();
}

function deplacerNiveau(i, sens) {
  const j = i + sens;
  [formation.niveaux[i], formation.niveaux[j]] = [formation.niveaux[j], formation.niveaux[i]];
  if (selection === i) selection = j; else if (selection === j) selection = i;
  marquerModifie();
  rendreEditeur();
}

function supprimerNiveau(i) {
  if (!confirm(`Supprimer le niveau « ${formation.niveaux[i].titre} » et son quiz ?`)) return;
  formation.niveaux.splice(i, 1);
  selection = 'parametres';
  marquerModifie();
  rendreEditeur();
}

function panneauNiveau(i) {
  const n = formation.niveaux[i];
  return el('div', { class: 'pile' },
    el('section', { class: 'carte-edition' },
      el('div', { class: 'titre-ligne' },
        el('h1', {}, `Niveau ${i + 1}`),
        el('button', { type: 'button', class: 'bouton danger petit', onclick: () => supprimerNiveau(i) }, 'Supprimer le niveau')),
      champ('Titre', texteLie(n, 'titre', { max: 200, apres: (v) => {
        const item = document.querySelectorAll('.item-titre')[i];
        if (item) item.textContent = v || 'Sans titre';
      } })),
      champ('Résumé', texteLie(n, 'resume', { max: 400, placeholder: 'Une ligne affichée sur le chemin des niveaux' })),
      champ('Seuil propre à ce niveau (%)', el('input', {
        type: 'number', min: 0, max: 100, value: n.seuil ?? '', placeholder: `${formation.seuil} (seuil de la formation)`,
        oninput: (e) => { if (e.target.value === '') delete n.seuil; else n.seuil = Number(e.target.value); marquerModifie(); },
      }), 'Laisser vide pour utiliser le seuil de la formation.')),
    el('section', { class: 'carte-edition' },
      el('h2', {}, 'Leçon'),
      el('p', { class: 'aide' }, 'Chaque « Nouvelle étape » découpe la leçon en cartes successives : une idée par écran.'),
      editeurLecon(n)),
    el('section', { class: 'carte-edition' },
      el('h2', {}, 'Quiz'),
      el('p', { class: 'aide' }, 'Cochez la ou les bonnes réponses. L\'ordre des choix est mélangé à l\'affichage.'),
      editeurQuiz(n)));
}

// ---------- Éditeur de leçon (texte enrichi) ----------

function blocCourant(zone) {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  let noeud = sel.getRangeAt(0).startContainer;
  if (!zone.contains(noeud) || noeud === zone) return null;
  while (noeud && noeud.parentNode !== zone) noeud = noeud.parentNode;
  // Du texte posé directement dans la zone devient un vrai paragraphe.
  if (noeud && (noeud.nodeType === Node.TEXT_NODE || ['STRONG', 'EM', 'A', 'BR'].includes(noeud.tagName))) {
    const p = document.createElement('p');
    noeud.replaceWith(p);
    p.append(noeud);
    return p;
  }
  return noeud;
}

function editeurLecon(n) {
  const zone = el('div', {
    class: 'zone-lecon contenu-lecon', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
    'aria-label': 'Texte de la leçon', html: nettoyerHtml(n.lecon).replace(/^(<p><\/p>)?$/, '<p><br></p>'),
    onfocus: () => document.execCommand('defaultParagraphSeparator', false, 'p'),
    oninput: () => { n.lecon = zone.innerHTML; marquerModifie(); },
    onpaste: (e) => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html');
      const texte = e.clipboardData.getData('text/plain');
      const propre = html ? nettoyerHtml(html) : texte.split(/\n{2,}/).map((p) => `<p>${p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>')}</p>`).join('');
      document.execCommand('insertHTML', false, propre);
    },
  });

  const commande = (cmd, valeur) => () => { zone.focus(); document.execCommand(cmd, false, valeur); zone.dispatchEvent(new Event('input')); };

  function encadrer(classe) {
    return () => {
      zone.focus();
      const bloc = blocCourant(zone);
      if (!bloc || bloc.nodeType !== Node.ELEMENT_NODE) return annoncer('Placez le curseur dans un paragraphe.');
      if (bloc.tagName === 'DIV' && CLASSES_ENCADRE.some((c) => bloc.classList.contains(c))) {
        if (bloc.classList.contains(classe)) bloc.replaceWith(...bloc.childNodes);
        else bloc.className = classe;
      } else {
        const cadre = el('div', { class: classe });
        bloc.replaceWith(cadre);
        cadre.append(bloc);
      }
      zone.dispatchEvent(new Event('input'));
    };
  }

  function nouvelleEtape() {
    zone.focus();
    const bloc = blocCourant(zone);
    const separateur = el('hr', { class: 'etape' });
    const suite = el('p', {}, el('br'));
    if (bloc) bloc.after(separateur, suite); else zone.append(separateur, suite);
    const r = document.createRange();
    r.setStart(suite, 0);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    zone.dispatchEvent(new Event('input'));
  }

  async function insererImage() {
    const sel = getSelection();
    const plage = sel.rangeCount && zone.contains(sel.getRangeAt(0).startContainer) ? sel.getRangeAt(0).cloneRange() : null;
    const url = await choisirImage();
    if (!url) return;
    const legende = prompt('Légende de l\'image (facultatif) :') || '';
    const alt = prompt('Description pour les lecteurs d\'écran :', legende) || '';
    const figure = el('figure', {}, el('img', { src: url, alt }), legende && el('figcaption', {}, legende));
    const bloc = plage ? (() => { let x = plage.startContainer; while (x && x.parentNode !== zone) x = x.parentNode; return x; })() : null;
    if (bloc) bloc.after(figure); else zone.append(figure);
    zone.dispatchEvent(new Event('input'));
  }

  function lien() {
    const url = prompt('Adresse du lien (https://…) :', 'https://');
    if (url && /^https?:\/\//.test(url)) commande('createLink', url)();
  }

  const outil = (libelle, titre, action, classe = '') => el('button', {
    type: 'button', class: `outil ${classe}`, title: titre, 'aria-label': titre,
    onmousedown: (e) => e.preventDefault(), onclick: action,
  }, libelle);

  const barre = el('div', { class: 'barre-outils', role: 'toolbar', 'aria-label': 'Mise en forme' },
    outil('Titre', 'Intertitre', commande('formatBlock', 'h3')),
    outil('¶', 'Paragraphe normal', commande('formatBlock', 'p')),
    outil('G', 'Gras', commande('bold'), 'gras'),
    outil('I', 'Italique', commande('italic'), 'italique'),
    outil('• Liste', 'Liste à puces', commande('insertUnorderedList')),
    outil('1. Liste', 'Liste numérotée', commande('insertOrderedList')),
    outil('🔗', 'Lien', lien),
    el('span', { class: 'separateur' }),
    outil('✦ À retenir', 'Encadré « À retenir »', encadrer('encadre'), 'o-encadre'),
    outil('◈ Exemple', 'Encadré « Exemple »', encadrer('exemple'), 'o-exemple'),
    outil('⚠︎ Attention', 'Encadré « À ne pas confondre »', encadrer('attention'), 'o-attention'),
    el('span', { class: 'separateur' }),
    outil('🖼 Image', 'Insérer une image', insererImage),
    outil('⎯ Nouvelle étape', 'Découper : la suite s\'affichera sur une nouvelle carte', nouvelleEtape, 'o-etape'),
    outil('↶', 'Annuler', commande('undo')));

  return el('div', { class: 'editeur-lecon' }, barre, zone);
}

// ---------- Éditeur de quiz ----------

function editeurQuiz(n) {
  const conteneur = el('div', { class: 'quiz-edition' });

  function rendre() {
    conteneur.replaceChildren(
      ...n.questions.map((q, j) => carteQuestion(q, j)),
      el('button', { type: 'button', class: 'bouton secondaire large', onclick: () => {
        n.questions.push({ id: idUnique(`q-${n.questions.length + 1}`, n.questions.map((x) => x.id)), enonce: '', image: '', choix: ['', ''], bonnes: [], explication: '' });
        marquerModifie();
        rendre();
        conteneur.querySelectorAll('.carte-question textarea')[n.questions.length * 2 - 2]?.focus();
      } }, '+ Ajouter une question'));
  }

  function carteQuestion(q, j) {
    const deplacer = (sens) => {
      const k = j + sens;
      [n.questions[j], n.questions[k]] = [n.questions[k], n.questions[j]];
      marquerModifie();
      rendre();
    };
    return el('div', { class: 'carte-question' },
      el('div', { class: 'titre-ligne' },
        el('span', { class: 'etiquette' }, `Question ${j + 1}`),
        el('span', { class: 'boutons-ligne' },
          el('button', { type: 'button', class: 'icone', 'aria-label': 'Monter la question', disabled: j === 0, onclick: () => deplacer(-1) }, '↑'),
          el('button', { type: 'button', class: 'icone', 'aria-label': 'Descendre la question', disabled: j === n.questions.length - 1, onclick: () => deplacer(1) }, '↓'),
          el('button', { type: 'button', class: 'icone danger', 'aria-label': 'Supprimer la question', onclick: () => {
            if (!confirm('Supprimer cette question ?')) return;
            n.questions.splice(j, 1); marquerModifie(); rendre();
          } }, '✕'))),
      champ('Énoncé', texteLie(q, 'enonce', { lignes: 2, max: 1000, placeholder: 'La question posée à l\'apprenant' })),
      el('div', { class: 'champ' },
        el('span', { class: 'etiquette' }, 'Choix — cochez la ou les bonnes réponses'),
        q.choix.map((c, k) => el('div', { class: `ligne-choix ${q.bonnes.includes(k) ? 'bon' : ''}` },
          el('input', { type: 'checkbox', checked: q.bonnes.includes(k), 'aria-label': `Choix ${k + 1} est une bonne réponse`, onchange: (e) => {
            q.bonnes = e.target.checked ? [...q.bonnes, k].sort((a, b) => a - b) : q.bonnes.filter((b) => b !== k);
            e.target.closest('.ligne-choix').classList.toggle('bon', e.target.checked);
            marquerModifie();
          } }),
          el('input', { type: 'text', value: c, maxlength: 500, placeholder: `Choix ${k + 1}`, oninput: (e) => { q.choix[k] = e.target.value; marquerModifie(); } }),
          el('button', { type: 'button', class: 'icone', 'aria-label': `Retirer le choix ${k + 1}`, disabled: q.choix.length <= 2, onclick: () => {
            q.choix.splice(k, 1);
            q.bonnes = q.bonnes.filter((b) => b !== k).map((b) => (b > k ? b - 1 : b));
            marquerModifie(); rendre();
          } }, '✕'))),
        q.choix.length < 10 && el('button', { type: 'button', class: 'bouton discret petit', onclick: () => { q.choix.push(''); marquerModifie(); rendre(); } }, '+ Ajouter un choix')),
      champ('Explication (affichée après la réponse)', texteLie(q, 'explication', { lignes: 2, max: 2000, placeholder: 'Pourquoi c\'est la bonne réponse — avec la source si possible' })),
      blocImage(q, 'image', 'Visuel de la question (facultatif)'));
  }

  rendre();
  return conteneur;
}

// ---------- Enregistrement ----------

async function enregistrer() {
  formation.niveaux.forEach((n) => { n.lecon = nettoyerHtml(n.lecon); });
  try {
    const reponse = await api('PUT', `admin/formations/${formation.id}`, formation);
    formation = reponse.formation;
    bilan = { erreurs: reponse.erreurs, avertissements: reponse.avertissements };
    modifie = false;
    annoncer(formation.publie ? 'Enregistré et publié.' : 'Brouillon enregistré.', 'succes');
  } catch (e) {
    if (e.details?.erreurs) bilan = { erreurs: e.details.erreurs, avertissements: e.details.avertissements || [] };
    annoncer(e.message, 'erreur');
  }
  rendreEditeur();
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && formation && location.hash.startsWith('#/f/')) {
    e.preventDefault();
    enregistrer();
  }
});

// ---------- Navigation ----------

async function routeur() {
  try {
    const session = await api('GET', 'admin/session');
    if (!session.connecte) return vueConnexion();
    const m = location.hash.match(/^#\/f\/([a-z0-9-]+)$/);
    if (m) await vueEditeur(m[1]);
    else { formation = null; await vueListe(); }
  } catch (e) {
    annoncer(e.message, 'erreur');
  }
}

window.addEventListener('hashchange', routeur);
routeur();
