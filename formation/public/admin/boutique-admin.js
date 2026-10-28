// Back-office de la boutique : offres de l'agenda, liens personnels, inscriptions et encaissements.

import { TYPES_OFFRE, PAIEMENTS, euros, echeancier, commissionSur, dateLisible, verifierOffre, normaliserOffre } from '../commun/offres.js';

let o = {}; // outils fournis par admin.js : el, api, annoncer, champ, enTete, choisirImage, app

export function installer(outils) { o = outils; }

const versCentimes = (texte) => Math.round(Number(String(texte).replace(',', '.').replace(/\s/g, '')) * 100);
const versEuros = (centimes) => (centimes ? String(centimes / 100).replace('.', ',') : '');

async function copier(texte, quoi = 'Lien copié.') {
  try { await navigator.clipboard.writeText(texte); o.annoncer(quoi, 'succes'); } catch { prompt('Copiez ce lien :', texte); }
}

function partage(url, message) {
  const { el } = o;
  return el('div', { class: 'boutons-ligne' },
    el('button', { type: 'button', class: 'bouton secondaire petit', onclick: () => copier(url) }, 'Copier le lien'),
    el('a', { class: 'bouton secondaire petit', href: `https://wa.me/?text=${encodeURIComponent(`${message}\n${url}`)}`, target: '_blank', rel: 'noopener' }, 'Envoyer par WhatsApp'));
}

const STATUTS = {
  'en-attente': 'En attente de paiement', payee: 'Réglée', 'en-cours': 'Versements en cours',
  retiree: 'Accès retiré', expiree: 'Abandonnée',
};
const MODES = { stripe: 'Carte (Stripe)', simulation: 'Simulation', gratuit: 'Gratuit', 'hors-ligne': 'Hors ligne' };

// ---------- Liste des offres ----------

export async function vueOffres() {
  const { el, api, app, enTete } = o;
  const [offres, etat] = await Promise.all([api('GET', 'admin/boutique/offres'), api('GET', 'admin/boutique/etat')]);
  app.replaceChildren(
    enTete(el('span', { class: 'titre-barre' }, 'Offres')),
    el('main', { class: 'page-admin' },
      bandeauEtat(etat),
      el('div', { class: 'titre-ligne' },
        el('h1', {}, 'Offres et agenda'),
        el('button', { type: 'button', class: 'bouton', onclick: creerOffre }, '+ Nouvelle offre')),
      el('p', { class: 'aide' }, 'Chaque offre (cercle, stage, accompagnement…) peut ouvrir l\'accès à une ou plusieurs formations dès le paiement.'),
      offres.length === 0
        ? el('p', { class: 'vide' }, 'Aucune offre. Créez la première.')
        : el('ul', { class: 'liste-formations' }, offres.map((x) => el('li', { class: 'ligne-formation' },
          el('div', { class: 'vignette', 'aria-hidden': 'true' }, (TYPES_OFFRE[x.type] || '✦')[0]),
          el('div', { class: 'ligne-texte' },
            el('a', { href: `#/o/${x.id}`, class: 'ligne-titre' }, x.titre),
            el('span', { class: 'etiquette' },
              el('span', { class: `pastille ${x.publie ? 'publie' : ''}` }, x.publie ? 'Publiée' : 'Brouillon'),
              ` · ${TYPES_OFFRE[x.type]} · ${x.prix ? euros(x.prix) : 'gratuit'}${x.echeances === 3 ? ' (3×)' : ''}`,
              x.date ? ` · ${dateLisible(x.date)}` : '',
              ` · ${x.inscrits} inscrit${x.inscrits > 1 ? 's' : ''}${x.places ? ` / ${x.places}` : ''}`,
              x.enAttente ? ` · ${x.enAttente} en liste d'attente` : '')),
          el('div', { class: 'boutons-ligne' },
            el('a', { class: 'bouton secondaire petit', href: `#/o/${x.id}` }, 'Modifier'),
            x.publie && el('a', { class: 'bouton discret petit', href: `../boutique/#/offre/${x.id}`, target: '_blank', rel: 'noopener' }, 'Voir'))))),
    ));
}

function bandeauEtat(etat) {
  const { el } = o;
  const paiement = {
    aucun: ['Paiement en ligne fermé', 'Ajoutez la clé Stripe sur le serveur : seules les offres gratuites se réservent pour l\'instant.'],
    simulation: ['Mode essai', 'Les paiements sont simulés : aucun argent ne circule.'],
    test: ['Stripe en mode test', 'Cartes de test uniquement (4242 4242 4242 4242).'],
    reel: ['Stripe en mode réel', ''],
  }[etat.paiement];
  const alertes = [
    etat.paiement !== 'aucun' && etat.paiement !== 'simulation' && !etat.compteRelie && 'Compte Stripe de Maât Soby non relié : les paiements arrivent sur le compte de la plateforme.',
    (etat.paiement === 'test' || etat.paiement === 'reel') && !etat.webhook && 'Webhook Stripe non configuré : les versements 2 et 3 ne seront pas confirmés automatiquement.',
    !etat.courriel && 'E-mails non branchés : envoyez les liens de connexion vous-même (bouton « Lien de connexion »).',
  ].filter(Boolean);
  return el('details', { class: `bilan etat-boutique ${etat.paiement === 'reel' && !alertes.length ? 'ok' : ''}`, open: alertes.length > 0 },
    el('summary', {}, `${paiement[0]} · commission plateforme ${etat.commission} %${alertes.length ? ` · ${alertes.length} point${alertes.length > 1 ? 's' : ''} à régler` : ''}`),
    el('ul', {}, paiement[1] && el('li', {}, paiement[1]), alertes.map((a) => el('li', { class: 'bloquant' }, a))));
}

async function creerOffre() {
  const titre = prompt('Titre de la nouvelle offre (ex. « Cercle de la nouvelle lune ») :');
  if (!titre?.trim()) return;
  try {
    const x = await o.api('POST', 'admin/boutique/offres', { titre });
    location.hash = `#/o/${x.id}`;
  } catch (e) { o.annoncer(e.message, 'erreur'); }
}

// ---------- Édition d'une offre ----------

export async function vueOffre(id) {
  const { el, api, app, enTete, champ } = o;
  const [offre, formations, etat] = await Promise.all([
    api('GET', `admin/boutique/offres/${id}`), api('GET', 'admin/formations'), api('GET', 'admin/boutique/etat'),
  ]);
  const x = structuredClone(offre);
  const etatEnr = el('span', { class: 'etat-enregistrement' }, '✓ Enregistré');
  const sale = () => { etatEnr.textContent = '● Non enregistré'; etatEnr.className = 'etat-enregistrement sale'; recalculer(); };

  const texte = (cle, attrs = {}) => el(attrs.lignes ? 'textarea' : 'input', {
    ...(attrs.lignes ? { rows: attrs.lignes } : { type: attrs.type || 'text' }),
    value: x[cle] ?? '', placeholder: attrs.placeholder, maxlength: attrs.max,
    oninput: (e) => { x[cle] = e.target.value; sale(); },
  });
  const liste = (cle, options) => el('select', { onchange: (e) => { x[cle] = e.target.value; sale(); afficherContact(); } },
    Object.entries(options).map(([v, l]) => el('option', { value: v, selected: x[cle] === v }, l)));
  const caseA = (cle, libelle, aide, vrai = true, faux = false) => el('label', { class: 'interrupteur' },
    el('input', { type: 'checkbox', checked: x[cle] === vrai, onchange: (e) => { x[cle] = e.target.checked ? vrai : faux; sale(); } }),
    el('span', {}, el('strong', {}, libelle), aide && el('br'), aide && el('span', { class: 'aide' }, aide)));

  const prix = el('input', { type: 'text', inputmode: 'decimal', value: versEuros(x.prix), placeholder: '0 = gratuit', oninput: (e) => { x.prix = versCentimes(e.target.value || 0) || 0; sale(); } });
  const repartition = el('p', { class: 'aide repartition' });
  function recalculer() {
    const c = commissionSur(x.prix, etat.commission);
    repartition.textContent = x.prix
      ? `Sur ${euros(x.prix)} : ${euros(c)} de commission plateforme (${etat.commission} %), ${euros(x.prix - c)} pour Maât Soby avant les frais Stripe.${x.echeances === 3 ? ` En 3 fois : ${echeancier(x.prix, 3).map(euros).join(' + ')}.` : ''}`
      : 'Offre gratuite : l\'inscription est immédiate.';
  }
  const blocContact = el('div');
  function afficherContact() {
    blocContact.replaceChildren(x.paiement === 'invitation'
      ? champ('Lien « Prendre contact »', texte('contact', { max: 500, placeholder: 'https://wa.me/596… ou mailto:…' }),
        'Pour un accompagnement : le visiteur prend d\'abord contact, puis vous lui envoyez un lien personnel (plus bas).')
      : '');
  }
  afficherContact();

  const image = el('div', { class: 'bloc-image' });
  const rendreImage = () => image.replaceChildren(
    x.image ? el('img', { src: `../${x.image}`, alt: '' }) : el('div', { class: 'image-vide' }, 'Aucune image'),
    el('div', { class: 'boutons-ligne' },
      el('button', { type: 'button', class: 'bouton secondaire petit', onclick: async () => {
        const url = await o.choisirImage();
        if (url) { x.image = url; sale(); rendreImage(); }
      } }, x.image ? 'Remplacer' : 'Ajouter une image'),
      x.image && el('button', { type: 'button', class: 'bouton discret petit', onclick: () => { x.image = ''; sale(); rendreImage(); } }, 'Retirer')));
  rendreImage();

  const choixFormations = formations.length
    ? el('div', { class: 'cases' }, formations.map((f) => el('label', { class: 'interrupteur serre' },
      el('input', { type: 'checkbox', checked: x.formations.includes(f.id), onchange: (e) => {
        x.formations = e.target.checked ? [...x.formations, f.id] : x.formations.filter((y) => y !== f.id);
        sale();
      } }),
      el('span', {}, f.titre, f.acces !== 'reserve' && el('span', { class: 'aide' }, ' — libre d\'accès (à passer en « réservée » dans ses paramètres)')))))
    : el('p', { class: 'aide' }, 'Aucune formation pour l\'instant.');

  async function enregistrer() {
    const erreurs = verifierOffre(normaliserOffre(x));
    if (erreurs.length) { o.annoncer(erreurs.join(' '), 'erreur'); return; }
    try {
      Object.assign(x, await api('PUT', `admin/boutique/offres/${id}`, x));
      etatEnr.textContent = '✓ Enregistré';
      etatEnr.className = 'etat-enregistrement';
      o.annoncer('Offre enregistrée.', 'succes');
    } catch (e) { o.annoncer(e.message, 'erreur'); }
  }

  async function supprimer() {
    if (!confirm(`Supprimer l'offre « ${x.titre} » ?`)) return;
    try {
      await api('DELETE', `admin/boutique/offres/${id}`);
      location.hash = '#/offres';
    } catch (e) { o.annoncer(e.message, 'erreur'); }
  }

  app.replaceChildren(
    enTete(
      el('a', { class: 'bouton discret petit', href: '#/offres' }, '← Offres'),
      el('span', { class: 'titre-barre' }, x.titre), etatEnr,
      el('a', { class: 'bouton secondaire petit', href: `../boutique/#/offre/${id}`, target: '_blank', rel: 'noopener' }, 'Aperçu'),
      el('button', { type: 'button', class: 'bouton petit', onclick: enregistrer }, 'Enregistrer')),
    el('main', { class: 'page-admin etroite pile' },
      el('section', { class: 'carte-edition' },
        el('h1', {}, 'L\'offre'),
        champ('Titre', texte('titre', { max: 200 })),
        el('div', { class: 'grille-2' },
          champ('Type', liste('type', TYPES_OFFRE)),
          champ('Réservation', liste('paiement', PAIEMENTS))),
        champ('En une phrase', texte('resume', { max: 300, placeholder: 'Affichée sur la liste des rendez-vous' })),
        champ('Présentation', texte('description', { lignes: 6, max: 5000, placeholder: 'Déroulé, intention, ce qu\'il faut apporter…' })),
        el('div', { class: 'champ' }, el('span', { class: 'etiquette' }, 'Image'), image),
        blocContact),
      el('section', { class: 'carte-edition' },
        el('h2', {}, 'Date, lieu et places'),
        el('div', { class: 'grille-2' },
          champ('Date et heure', texte('date', { type: 'datetime-local' }), 'Laisser vide pour une offre sans date.'),
          champ('Durée', texte('duree', { max: 100, placeholder: '2 h · 3 jours · 7 séances' }))),
        el('div', { class: 'grille-2' },
          champ('Lieu', texte('lieu', { max: 200, placeholder: 'En ligne · adresse' })),
          champ('Places', el('input', { type: 'number', min: 0, value: x.places, oninput: (e) => { x.places = Number(e.target.value) || 0; sale(); } }), '0 = sans limite.'))),
      el('section', { class: 'carte-edition' },
        el('h2', {}, 'Prix'),
        el('div', { class: 'grille-2' },
          champ('Prix (€)', prix),
          caseA('echeances', 'Paiement en 3 fois possible', 'Un versement par mois, prélevé automatiquement.', 3, 1)),
        repartition),
      el('section', { class: 'carte-edition' },
        el('h2', {}, 'Accès ouverts après le paiement'),
        el('p', { class: 'aide' }, 'Les formations cochées s\'ouvrent automatiquement dans l\'espace du stagiaire.'),
        choixFormations),
      el('section', { class: 'carte-edition' },
        caseA('publie', 'Publiée', 'Visible dans l\'agenda et sur le site de Maât Soby.'),
        el('div', { class: 'boutons-ligne', style: 'margin-top:1rem' },
          el('button', { type: 'button', class: 'bouton', onclick: enregistrer }, 'Enregistrer'),
          el('button', { type: 'button', class: 'bouton danger petit', onclick: supprimer }, 'Supprimer l\'offre'))),
      await sectionAttente(x),
      await sectionInvitations(x),
      sectionHorsLigne(x)));
  recalculer();
}

async function sectionAttente(x) {
  const { el, api } = o;
  const attente = (await api('GET', 'admin/boutique/attente')).filter((a) => a.offre === x.id);
  if (!attente.length) return null;
  const zone = el('ul', { class: 'liste-simple' });
  const rendre = (liste) => zone.replaceChildren(...liste.map((a, i) => el('li', {},
    el('div', {}, el('strong', {}, `${i + 1}. ${a.nom}`), ` · ${a.email}`, el('br'),
      el('span', { class: 'aide' }, a.prevenuLe ? `prévenu·e le ${new Date(a.prevenuLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`
        : `en attente depuis le ${new Date(a.creeLe).toLocaleDateString('fr-FR')}`)),
    el('button', { type: 'button', class: 'bouton discret petit', onclick: async () => {
      if (!confirm(`Retirer ${a.nom} de la liste d'attente ?`)) return;
      try {
        await api('DELETE', `admin/boutique/attente/${a.id}`);
        liste.splice(liste.indexOf(a), 1);
        rendre(liste);
      } catch (e) { o.annoncer(e.message, 'erreur'); }
    } }, 'Retirer'))));
  rendre(attente);
  return el('section', { class: 'carte-edition' },
    el('h2', {}, 'Liste d\'attente'),
    el('p', { class: 'aide' }, 'Quand une place se libère (paiement abandonné, accès retiré, places ajoutées), les premières personnes sont prévenues par e-mail automatiquement.'),
    zone);
}

async function sectionInvitations(x) {
  const { el, api, champ } = o;
  const zone = el('div');
  async function rendre() {
    const invitations = (await api('GET', 'admin/boutique/invitations')).filter((i) => i.offre === x.id);
    zone.replaceChildren(invitations.length
      ? el('ul', { class: 'liste-simple' }, invitations.map((i) => el('li', {},
        el('div', {}, el('strong', {}, i.nom || i.email), ` · ${i.email} · ${euros(i.prix)}${i.echeances === 3 ? ' (3× possible)' : ''}`,
          el('br'), el('span', { class: 'aide' }, i.utiliseeLe ? `✓ réglé le ${new Date(i.utiliseeLe).toLocaleDateString('fr-FR')}`
            : i.expiree ? 'expiré' : `valable jusqu'au ${new Date(i.expire).toLocaleDateString('fr-FR')}`)),
        !i.utiliseeLe && !i.expiree && partage(i.url, `Bonjour ${i.nom || ''}, voici votre lien pour confirmer « ${x.titre} » :`),
        !i.utiliseeLe && el('button', { type: 'button', class: 'bouton discret petit', onclick: async () => {
          if (!confirm('Annuler ce lien ?')) return;
          await api('DELETE', `admin/boutique/invitations/${i.jeton}`);
          rendre();
        } }, 'Annuler'))))
      : el('p', { class: 'aide' }, 'Aucun lien personnel pour cette offre.'));
  }
  const nom = el('input', { type: 'text', maxlength: 120 });
  const email = el('input', { type: 'email', maxlength: 200 });
  const prix = el('input', { type: 'text', inputmode: 'decimal', value: versEuros(x.prix) });
  const trois = el('input', { type: 'checkbox', checked: x.echeances === 3 });
  await rendre();
  return el('section', { class: 'carte-edition' },
    el('h2', {}, 'Liens personnels'),
    el('p', { class: 'aide' }, 'Après un Appel d\'Âme : créez un lien de paiement au nom de la personne, puis envoyez-le-lui. Son accès s\'ouvre dès le paiement.'),
    el('form', { onsubmit: async (e) => {
      e.preventDefault();
      try {
        const inv = await api('POST', 'admin/boutique/invitations', {
          offre: x.id, nom: nom.value, email: email.value, prix: versCentimes(prix.value || 0), echeances: trois.checked ? 3 : 1,
        });
        nom.value = ''; email.value = '';
        await rendre();
        copier(inv.url, 'Lien créé et copié : collez-le dans votre message.');
      } catch (err) { o.annoncer(err.message, 'erreur'); }
    } },
    el('div', { class: 'grille-2' }, champ('Prénom et nom', nom), champ('E-mail', email)),
    el('div', { class: 'grille-2' }, champ('Prix convenu (€)', prix),
      el('label', { class: 'interrupteur' }, trois, el('span', {}, el('strong', {}, 'Proposer le paiement en 3 fois')))),
    el('button', { type: 'submit', class: 'bouton secondaire' }, 'Créer le lien')),
    zone);
}

function sectionHorsLigne(x) {
  const { el, api, champ } = o;
  const nom = el('input', { type: 'text', maxlength: 120 });
  const email = el('input', { type: 'email', maxlength: 200 });
  const montant = el('input', { type: 'text', inputmode: 'decimal', value: versEuros(x.prix) });
  const note = el('input', { type: 'text', maxlength: 300, placeholder: 'Espèces, virement…' });
  return el('section', { class: 'carte-edition' },
    el('h2', {}, 'Inscrire quelqu\'un qui a réglé autrement'),
    el('p', { class: 'aide' }, 'Pour un paiement en espèces ou par virement : la personne reçoit les mêmes accès.'),
    el('form', { onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('POST', 'admin/boutique/acces', { offre: x.id, nom: nom.value, email: email.value, montant: versCentimes(montant.value || 0), note: note.value });
        nom.value = ''; email.value = ''; note.value = '';
        o.annoncer('Inscription enregistrée, accès ouvert.', 'succes');
      } catch (err) { o.annoncer(err.message, 'erreur'); }
    } },
    el('div', { class: 'grille-2' }, champ('Prénom et nom', nom), champ('E-mail', email)),
    el('div', { class: 'grille-2' }, champ('Montant reçu (€)', montant), champ('Note', note)),
    el('button', { type: 'submit', class: 'bouton secondaire' }, 'Inscrire et ouvrir l\'accès')));
}

// ---------- Inscriptions et encaissements ----------

export async function vueInscriptions() {
  const { el, api, app, enTete } = o;
  const [{ totaux, commandes }, etat] = await Promise.all([api('GET', 'admin/boutique/inscriptions'), api('GET', 'admin/boutique/etat')]);
  const offres = [...new Map(commandes.map((c) => [c.offre, c.offreTitre])).entries()];
  const zone = el('ul', { class: 'liste-formations' });
  const filtre = el('select', { onchange: () => rendre() },
    el('option', { value: '' }, 'Toutes les offres'), offres.map(([id, titre]) => el('option', { value: id }, titre)));

  async function action(c, quoi) {
    if (quoi === 'retirer' && !confirm(`Retirer l'accès de ${c.nom} ? (le remboursement éventuel se fait dans Stripe)`)) return;
    try {
      const r = await api('POST', `admin/boutique/commandes/${c.id}/${quoi}`);
      if (quoi === 'lien') { copier(r.url, 'Lien de connexion copié (valable 3 jours).'); return; }
      Object.assign(c, r);
      rendre();
    } catch (e) { o.annoncer(e.message, 'erreur'); }
  }

  function rendre() {
    const visibles = commandes.filter((c) => !filtre.value || c.offre === filtre.value);
    zone.replaceChildren(...(visibles.length ? visibles.map((c) => el('li', { class: 'ligne-formation inscription-admin' },
      el('div', { class: 'ligne-texte' },
        el('span', { class: 'ligne-titre' }, c.nom || c.email),
        el('span', { class: 'aide' }, `${c.email}${c.telephone ? ` · ${c.telephone}` : ''}`),
        el('span', { class: 'etiquette' },
          el('span', { class: `pastille ${['payee', 'en-cours'].includes(c.statut) ? 'publie' : ''}` }, STATUTS[c.statut] || c.statut),
          ` · ${c.offreTitre} · ${c.total ? euros(c.total) : 'gratuit'} · ${MODES[c.mode] || c.mode} · ${new Date(c.creeLe).toLocaleDateString('fr-FR')}`),
        c.echeances.length > 1 && el('span', { class: 'aide' }, c.echeances.map((v) => `${v.numero}) ${euros(v.montant)} ${
          v.statut === 'payee' ? '✓' : v.statut === 'echec' ? `✗ ${v.erreur || 'refusé'}` : v.du ? `le ${new Date(v.du).toLocaleDateString('fr-FR')}` : 'à venir'}`).join(' · ')),
        c.note && el('span', { class: 'aide' }, c.note)),
      el('div', { class: 'boutons-ligne' },
        c.stagiaire && el('button', { type: 'button', class: 'bouton secondaire petit', onclick: () => action(c, 'lien') }, 'Lien de connexion'),
        c.echeances.some((v) => v.statut === 'echec') && el('button', { type: 'button', class: 'bouton petit', onclick: () => action(c, 'relancer') }, 'Relancer le versement'),
        ['payee', 'en-cours'].includes(c.statut) && el('button', { type: 'button', class: 'bouton danger petit', onclick: () => action(c, 'retirer') }, 'Retirer l\'accès'),
        c.statut === 'retiree' && el('button', { type: 'button', class: 'bouton discret petit', onclick: () => action(c, 'retablir') }, 'Rétablir'))))
      : [el('p', { class: 'vide' }, 'Aucune inscription pour le moment.')]));
  }
  rendre();

  const tuile = (libelle, valeur, aide) => el('div', { class: 'tuile' }, el('span', { class: 'etiquette' }, libelle), el('strong', {}, valeur), aide && el('span', { class: 'aide' }, aide));
  app.replaceChildren(
    enTete(el('span', { class: 'titre-barre' }, 'Inscriptions')),
    el('main', { class: 'page-admin' },
      bandeauEtat(etat),
      el('h1', {}, 'Inscriptions et encaissements'),
      el('div', { class: 'tuiles' },
        tuile('Encaissé en ligne', euros(totaux.encaisse), 'sur le compte de Maât Soby'),
        tuile(`Commission ${etat.commission} %`, euros(totaux.commission), 'prélevée par la plateforme'),
        tuile('Réglé hors ligne', euros(totaux.horsLigne), totaux.horsLigne ? `commission due : ${euros(commissionSur(totaux.horsLigne, etat.commission))}` : ''),
        tuile('Versements à venir', euros(totaux.aVenir))),
      el('div', { class: 'titre-ligne' }, el('h2', {}, `${commandes.length} inscription${commandes.length > 1 ? 's' : ''}`), filtre),
      zone));
}
