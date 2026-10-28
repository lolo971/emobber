// Outil de formation : parcours en niveaux, chaque niveau se débloque quand
// le quiz du précédent est réussi. Le contenu vit dans contenu/ ; ce fichier
// ne contient aucune matière pédagogique.

const CONTENU = 'contenu/';
const SEUIL_DEFAUT = 80;
const app = document.getElementById('app');

let parcours = null;
const niveauxCharges = new Map();

// ---------- Utilitaires ----------

function el(tag, attributs = {}, ...enfants) {
  const noeud = document.createElement(tag);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (valeur === false || valeur == null) continue;
    if (cle.startsWith('on')) noeud.addEventListener(cle.slice(2), valeur);
    else noeud.setAttribute(cle, valeur === true ? '' : valeur);
  }
  for (const enfant of enfants.flat()) {
    if (enfant == null || enfant === false) continue;
    noeud.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return noeud;
}

async function charger(url, format) {
  const reponse = await fetch(url, { cache: 'no-cache' });
  if (!reponse.ok) throw new Error(`Impossible de charger ${url} (${reponse.status})`);
  return format === 'json' ? reponse.json() : reponse.text();
}

function afficher(...noeuds) {
  app.replaceChildren(...noeuds.filter((n) => n != null && n !== false && n !== ''));
  app.focus();
  window.scrollTo(0, 0);
}

function afficherErreur(erreur) {
  console.error(erreur);
  afficher(el('p', { class: 'erreur' }, erreur.message));
}

// ---------- Progression (navigateur) ----------

function cleProgression() {
  return `formation:${parcours.id}`;
}

function progressionVide() {
  return { version: 1, niveaux: {} };
}

function lireProgression() {
  try {
    const p = JSON.parse(localStorage.getItem(cleProgression()));
    if (p && p.version === 1 && typeof p.niveaux === 'object') return p;
  } catch { /* stockage indisponible ou corrompu */ }
  return progressionVide();
}

function ecrireProgression(p) {
  try {
    localStorage.setItem(cleProgression(), JSON.stringify(p));
  } catch { /* navigation privée : la progression ne survivra pas à l'onglet */ }
}

function statutNiveau(index, progression) {
  const niveau = parcours.niveaux[index];
  if (progression.niveaux[niveau.id]?.reussi) return 'reussi';
  if (index === 0) return 'ouvert';
  const precedent = parcours.niveaux[index - 1];
  return progression.niveaux[precedent.id]?.reussi ? 'ouvert' : 'verrouille';
}

const LIBELLES = { reussi: 'Réussi', ouvert: 'Ouvert', verrouille: 'Verrouillé' };

// ---------- Accueil ----------

function vueAccueil() {
  const progression = lireProgression();
  const total = parcours.niveaux.length;
  const reussis = parcours.niveaux.filter((n) => progression.niveaux[n.id]?.reussi).length;
  const pourcentage = total ? Math.round((reussis / total) * 100) : 0;

  const cartes = parcours.niveaux.map((niveau, index) => {
    const statut = statutNiveau(index, progression);
    const meilleur = progression.niveaux[niveau.id]?.meilleurScore;
    const contenu = [
      el('span', { class: 'carte-numero', 'aria-hidden': 'true' }, statut === 'reussi' ? '✓' : index + 1),
      el('div', {},
        el('p', { class: 'carte-titre' }, `Niveau ${index + 1} — ${niveau.titre}`),
        el('p', { class: 'carte-resume' }, niveau.resume,
          meilleur != null ? ` · meilleur score : ${meilleur} %` : ''),
      ),
      el('span', { class: `badge ${statut}` }, statut === 'verrouille' ? '🔒 ' : '', LIBELLES[statut]),
    ];
    const carte = statut === 'verrouille'
      ? el('div', { class: `carte ${statut}`, 'aria-disabled': 'true' }, contenu)
      : el('a', { class: `carte ${statut}`, href: `#/niveau/${encodeURIComponent(niveau.id)}` }, contenu);
    return el('li', {}, carte);
  });

  afficher(
    el('h1', {}, parcours.titre),
    parcours.sousTitre && el('p', { class: 'sous-titre' }, parcours.sousTitre),
    el('div', { class: 'progression' },
      el('div', { class: 'progression-texte' },
        el('span', {}, `${reussis} / ${total} niveaux réussis`),
        el('span', {}, `${pourcentage} %`)),
      el('div', {
        class: 'progression-barre', role: 'progressbar',
        'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': reussis,
        'aria-label': 'Progression du parcours',
      }, el('span', { style: `width: ${pourcentage}%` })),
    ),
    el('ol', { class: 'niveaux' }, cartes),
    total > 0 && reussis === total &&
      el('p', { class: 'felicitations' }, '🎉 Parcours terminé : tous les niveaux sont réussis.'),
    outilsProgression(),
  );
}

function outilsProgression() {
  const importer = el('input', {
    type: 'file', accept: 'application/json', hidden: true,
    onchange: async (e) => {
      const fichier = e.target.files[0];
      if (!fichier) return;
      try {
        const donnees = JSON.parse(await fichier.text());
        if (donnees.parcours !== parcours.id || donnees.version !== 1) {
          throw new Error('Ce fichier ne correspond pas à ce parcours.');
        }
        ecrireProgression({ version: 1, niveaux: donnees.niveaux || {} });
        vueAccueil();
      } catch (erreur) {
        alert(`Import impossible : ${erreur.message}`);
      }
    },
  });

  return el('section', { class: 'outils-progression', 'aria-label': 'Gérer ma progression' },
    el('p', { class: 'sous-titre' }, 'Votre progression est enregistrée dans ce navigateur.'),
    el('div', { class: 'actions' },
      el('button', { class: 'secondaire', type: 'button', onclick: exporterProgression }, 'Exporter'),
      el('button', { class: 'secondaire', type: 'button', onclick: () => importer.click() }, 'Importer'),
      el('button', {
        class: 'secondaire', type: 'button',
        onclick: () => {
          if (confirm('Effacer toute la progression de ce parcours ?')) {
            ecrireProgression(progressionVide());
            vueAccueil();
          }
        },
      }, 'Réinitialiser'),
      importer,
    ),
  );
}

function exporterProgression() {
  const donnees = { parcours: parcours.id, ...lireProgression(), exporteLe: new Date().toISOString() };
  const lien = el('a', {
    href: URL.createObjectURL(new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' })),
    download: `progression-${parcours.id}.json`,
  });
  document.body.append(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(lien.href);
}

// ---------- Niveau ----------

async function chargerNiveau(niveau) {
  if (!niveauxCharges.has(niveau.id)) {
    const dossier = `${CONTENU}${niveau.dossier}/`;
    const [lecon, quiz] = await Promise.all([
      charger(`${dossier}lecon.html`, 'texte'),
      charger(`${dossier}niveau.json`, 'json'),
    ]);
    niveauxCharges.set(niveau.id, { lecon, quiz });
  }
  return niveauxCharges.get(niveau.id);
}

async function vueNiveau(id) {
  const index = parcours.niveaux.findIndex((n) => n.id === id);
  if (index === -1) return afficherErreur(new Error(`Niveau inconnu : ${id}`));

  const niveau = parcours.niveaux[index];
  const retour = el('p', { class: 'fil' }, el('a', { href: '#/' }, '← Tous les niveaux'));

  if (statutNiveau(index, lireProgression()) === 'verrouille') {
    return afficher(retour,
      el('h1', {}, `🔒 Niveau ${index + 1} — ${niveau.titre}`),
      el('p', {}, `Réussissez d'abord le quiz du niveau ${index} pour ouvrir celui-ci.`));
  }

  const { lecon, quiz } = await chargerNiveau(niveau);
  const article = el('article', { class: 'lecon' });
  article.innerHTML = lecon; // contenu rédigé par l'auteur du parcours, de confiance

  afficher(
    retour,
    el('h1', {}, `Niveau ${index + 1} — ${niveau.titre}`),
    el('p', { class: 'sous-titre' }, niveau.resume),
    article,
    el('h2', {}, 'Quiz'),
    formulaireQuiz(niveau, index, quiz),
  );
}

function memeEnsemble(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function formulaireQuiz(niveau, index, quiz) {
  const seuil = quiz.seuil ?? parcours.seuilReussite ?? SEUIL_DEFAUT;
  const message = el('p', { class: 'message', role: 'alert' });
  const zoneResultat = el('div', { 'aria-live': 'polite' });
  const bouton = el('button', { type: 'submit' }, 'Valider mes réponses');

  const blocs = quiz.questions.map((question, q) => {
    const multiple = question.bonnes.length > 1;
    const nom = `q${q}`;
    const fieldset = el('fieldset', {},
      el('legend', {}, `${q + 1}. ${question.enonce}`),
      el('p', { class: 'consigne' }, multiple ? 'Plusieurs réponses possibles.' : 'Une seule réponse.'),
      question.choix.map((texte, c) => el('label', { class: 'choix' },
        el('input', { type: multiple ? 'checkbox' : 'radio', name: nom, value: c }),
        el('span', {}, texte))),
    );
    return { question, fieldset, nom };
  });

  const formulaire = el('form', {
    class: 'quiz', novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const reponses = blocs.map(({ nom }) =>
        [...formulaire.querySelectorAll(`input[name="${nom}"]:checked`)].map((i) => Number(i.value)));
      const sansReponse = reponses.findIndex((r) => r.length === 0);
      if (sansReponse !== -1) {
        message.textContent = `Répondez à la question ${sansReponse + 1} avant de valider.`;
        blocs[sansReponse].fieldset.querySelector('input').focus();
        return;
      }
      message.textContent = '';
      corriger(reponses);
    },
  }, blocs.map((b) => b.fieldset), message, el('div', { class: 'actions' }, bouton), zoneResultat);

  function corriger(reponses) {
    let justes = 0;
    blocs.forEach(({ question, fieldset }, q) => {
      const correct = memeEnsemble(reponses[q], question.bonnes);
      if (correct) justes += 1;
      fieldset.classList.add(correct ? 'correcte' : 'incorrecte');
      fieldset.querySelectorAll('.choix').forEach((label, c) => {
        if (question.bonnes.includes(c)) label.classList.add('bonne');
        else if (reponses[q].includes(c)) label.classList.add('fausse');
      });
      fieldset.querySelectorAll('input').forEach((i) => { i.disabled = true; });
      fieldset.append(el('p', { class: 'explication' },
        correct ? '✓ Correct. ' : '✗ Incorrect. ', question.explication || ''));
    });

    const score = Math.round((justes / blocs.length) * 100);
    const reussi = score >= seuil;

    const progression = lireProgression();
    const precedent = progression.niveaux[niveau.id] || { tentatives: 0, meilleurScore: 0, reussi: false };
    progression.niveaux[niveau.id] = {
      tentatives: precedent.tentatives + 1,
      meilleurScore: Math.max(precedent.meilleurScore, score),
      reussi: precedent.reussi || reussi,
      dateReussite: precedent.dateReussite || (reussi ? new Date().toISOString() : undefined),
    };
    ecrireProgression(progression);

    const suivant = parcours.niveaux[index + 1];
    bouton.remove();
    zoneResultat.replaceChildren(
      el('p', { class: `resultat ${reussi ? 'reussi' : 'echoue'}` },
        `Score : ${score} % (${justes} / ${blocs.length}) — `,
        reussi
          ? (suivant ? `réussi ! Le niveau ${index + 2} est débloqué.` : 'réussi ! Parcours terminé.')
          : `il faut ${seuil} % pour débloquer la suite. Relisez la leçon et réessayez.`),
      el('div', { class: 'actions' },
        reussi && suivant && el('a', { class: 'bouton', href: `#/niveau/${encodeURIComponent(suivant.id)}` },
          'Niveau suivant →'),
        el('button', { type: 'button', class: reussi ? 'secondaire' : '', onclick: () => vueNiveau(niveau.id) },
          'Recommencer le quiz'),
        el('a', { class: 'bouton secondaire', href: '#/' }, 'Tous les niveaux'),
      ),
    );
    zoneResultat.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return formulaire;
}

// ---------- Navigation ----------

function router() {
  const correspondance = location.hash.match(/^#\/niveau\/(.+)$/);
  const rendu = correspondance ? vueNiveau(decodeURIComponent(correspondance[1])) : vueAccueil();
  Promise.resolve(rendu).catch(afficherErreur);
}

async function demarrer() {
  try {
    parcours = await charger(`${CONTENU}parcours.json`, 'json');
    document.title = parcours.titre;
    window.addEventListener('hashchange', router);
    router();
  } catch (erreur) {
    afficherErreur(location.protocol === 'file:'
      ? new Error('Ouvrez ce site via un serveur web (voir formation/README.md), pas en double-cliquant le fichier.')
      : erreur);
  }
}

demarrer();
