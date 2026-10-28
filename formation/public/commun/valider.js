// Forme et règles d'une formation. Partagé par le serveur (Node) et les pages (navigateur).

export const SEUIL_DEFAUT = 80;
export const ID_VALIDE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MEDIA = /^medias\/[a-z0-9-]+\.(png|jpe?g|webp|gif)$/;

export function slug(texte) {
  return String(texte ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'sans-titre';
}

export function idUnique(base, existants) {
  const pris = new Set(existants);
  let id = slug(base);
  for (let n = 2; pris.has(id); n += 1) id = `${slug(base).slice(0, 44)}-${n}`;
  return id;
}

const texte = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const liste = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const media = (v) => (typeof v === 'string' && MEDIA.test(v) ? v : '');
const seuil = (v) => (v === '' || v == null || !Number.isFinite(Number(v))
  ? undefined : Math.min(100, Math.max(0, Math.round(Number(v)))));

// Ramène n'importe quelle entrée à la forme attendue, sans rien inventer.
export function normaliserFormation(f) {
  return {
    id: texte(f?.id, 64),
    titre: texte(f?.titre, 200),
    sousTitre: texte(f?.sousTitre, 300),
    description: texte(f?.description, 2000),
    image: media(f?.image),
    seuil: seuil(f?.seuil) ?? SEUIL_DEFAUT,
    publie: f?.publie === true,
    // « reserve » : ouverte seulement aux stagiaires inscrits à une offre qui la contient.
    acces: f?.acces === 'reserve' ? 'reserve' : 'libre',
    modifieLe: texte(f?.modifieLe, 40),
    niveaux: liste(f?.niveaux, 200).map((n) => {
      const s = seuil(n?.seuil);
      return {
        id: texte(n?.id, 64),
        titre: texte(n?.titre, 200),
        resume: texte(n?.resume, 400),
        lecon: texte(n?.lecon, 300000),
        ...(s !== undefined ? { seuil: s } : {}),
        questions: liste(n?.questions, 100).map((q) => ({
          id: texte(q?.id, 64),
          enonce: texte(q?.enonce, 1000),
          image: media(q?.image),
          choix: liste(q?.choix, 10).map((c) => texte(c, 500)),
          bonnes: [...new Set(liste(q?.bonnes, 10).filter(Number.isInteger))].sort((a, b) => a - b),
          explication: texte(q?.explication, 2000),
        })),
      };
    }),
  };
}

// Erreurs = bloquent la publication. Avertissements = à regarder, sans bloquer.
export function verifierFormation(f) {
  const erreurs = [];
  const avertissements = [];
  if (!ID_VALIDE.test(f.id)) erreurs.push('Identifiant de formation invalide.');
  if (!f.titre.trim()) erreurs.push('La formation n\'a pas de titre.');
  if (f.niveaux.length === 0) erreurs.push('La formation n\'a aucun niveau.');

  const idsNiveaux = new Set();
  f.niveaux.forEach((n, i) => {
    const ou = `Niveau ${i + 1}${n.titre ? ` « ${n.titre} »` : ''}`;
    if (!ID_VALIDE.test(n.id)) erreurs.push(`${ou} : identifiant invalide.`);
    if (idsNiveaux.has(n.id)) erreurs.push(`${ou} : identifiant en double.`);
    idsNiveaux.add(n.id);
    if (!n.titre.trim()) erreurs.push(`${ou} : titre manquant.`);
    if (!n.lecon.replace(/<[^>]*>/g, '').trim()) avertissements.push(`${ou} : leçon vide.`);
    if (n.questions.length === 0) erreurs.push(`${ou} : aucune question, le niveau suivant ne pourrait pas se débloquer.`);
    else if (n.questions.length < 3) avertissements.push(`${ou} : moins de 3 questions.`);

    n.questions.forEach((q, j) => {
      const ouQ = `${ou}, question ${j + 1}`;
      if (!q.enonce.trim()) erreurs.push(`${ouQ} : énoncé manquant.`);
      const remplis = q.choix.filter((c) => c.trim());
      if (remplis.length < 2) erreurs.push(`${ouQ} : au moins 2 choix sont nécessaires.`);
      if (remplis.length !== q.choix.length) erreurs.push(`${ouQ} : un choix est vide.`);
      if (new Set(q.choix).size !== q.choix.length) erreurs.push(`${ouQ} : deux choix sont identiques.`);
      if (q.bonnes.length === 0) erreurs.push(`${ouQ} : aucune bonne réponse cochée.`);
      if (q.bonnes.some((b) => b < 0 || b >= q.choix.length)) erreurs.push(`${ouQ} : bonne réponse hors des choix.`);
      if (!q.explication.trim()) avertissements.push(`${ouQ} : pas d'explication.`);
    });
  });
  return { erreurs, avertissements };
}

// Règles du mot de passe du back-office (affichées en direct et revérifiées par le serveur).
export const REGLES_MOT_DE_PASSE = [
  { texte: 'Au moins 10 caractères', test: (m) => m.length >= 10 },
  { texte: 'Au moins une lettre', test: (m) => /\p{L}/u.test(m) },
  { texte: 'Au moins un chiffre ou un symbole', test: (m) => /[^\p{L}\s]/u.test(m) },
  { texte: 'Pas d\'espace au début ni à la fin', test: (m) => m.length > 0 && m === m.trim() },
  { texte: '200 caractères au maximum', test: (m) => m.length <= 200 },
];

export function reglesNonRespectees(motDePasse) {
  const m = typeof motDePasse === 'string' ? motDePasse : '';
  return REGLES_MOT_DE_PASSE.filter((r) => !r.test(m)).map((r) => r.texte);
}
