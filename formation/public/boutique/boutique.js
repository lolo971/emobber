// Inscriptions : offres de l'agenda → paiement (Stripe) → confirmation → espace du stagiaire.

import { euros, echeancier, EMAIL_VALIDE } from '../commun/offres.js';

const app = document.getElementById('app');
const toast = document.getElementById('toast');
const NOM = 'Maât Soby';

// ---------- Outils ----------

function el(tag, attributs = {}, ...enfants) {
  const noeud = document.createElement(tag);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (valeur === false || valeur == null) continue;
    if (cle.startsWith('on')) noeud.addEventListener(cle.slice(2), valeur);
    else if (cle === 'value') noeud.value = valeur;
    else noeud.setAttribute(cle, valeur === true ? '' : valeur);
  }
  for (const enfant of enfants.flat(Infinity)) {
    if (enfant == null || enfant === false || enfant === '') continue;
    noeud.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return noeud;
}

const TRACES = {
  coche: 'M5 12.5l4.5 4.5L19 7.5',
  cadenas: 'M7 11V8a5 5 0 0 1 10 0v3 M5.5 11h13v9.5h-13Z M12 15v2.5',
  fleche: 'M9 5l7 7-7 7',
};
function ico(nom) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ class: `ico ico-${nom}`, viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
  const chemin = document.createElementNS(ns, 'path');
  chemin.setAttribute('d', TRACES[nom]);
  svg.append(chemin);
  return svg;
}

function afficher(...noeuds) {
  app.replaceChildren(...noeuds.flat().filter(Boolean));
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

let minuteur;
function annoncer(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(minuteur);
  minuteur = setTimeout(() => toast.classList.remove('visible'), 3200);
}

async function api(methode, chemin, corps) {
  const reponse = await fetch(`../api/${chemin}`, {
    method: methode,
    headers: { 'X-Requested-With': 'boutique', ...(corps ? { 'Content-Type': 'application/json' } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const e = new Error(donnees.erreur || 'Le serveur ne répond pas. Réessayez dans un instant.');
    e.statut = reponse.status;
    e.details = donnees;
    throw e;
  }
  return donnees;
}

function barre(retour) {
  return el('header', { class: 'barre-haut' },
    el('a', { class: 'marque', href: retour || '#/' }, retour ? '‹ Retour' : NOM.toUpperCase()),
    el('span', { class: 'barre-titre' }),
    el('a', { class: 'lien-espace', href: '#/compte' }, 'Mon espace'));
}

function erreur(message) {
  afficher(barre('#/'), el('main', { class: 'page' }, el('p', { class: 'vide' }, message),
    el('a', { class: 'bouton secondaire large', href: '#/' }, 'Voir les rendez-vous')));
}

function badgePlaces(o) {
  if (o.complet) return el('span', { class: 'badge complet' }, 'Complet');
  if (o.placesRestantes !== null && o.placesRestantes <= 5) {
    return el('span', { class: 'badge places' }, `${o.placesRestantes} place${o.placesRestantes > 1 ? 's' : ''}`);
  }
  return null;
}

function meta(o, complet = true) {
  return el('div', { class: 'meta' },
    complet && o.typeLibelle && el('span', {}, o.typeLibelle),
    complet && o.dateLisible && el('span', {}, o.dateLisible),
    complet && o.lieu && el('span', {}, o.lieu),
    el('span', { class: 'prix' }, o.paiement === 'invitation' ? 'Sur rendez-vous' : o.prix ? o.prixLisible : 'Gratuit'),
    badgePlaces(o));
}

// ---------- Liste des offres ----------

async function vueOffres() {
  const offres = await api('GET', 'boutique/offres');
  afficher(barre(), el('main', { class: 'page' },
    el('p', { class: 'etiquette' }, 'Agenda'),
    el('h1', {}, 'Cercles, rituels et stages'),
    el('p', { class: 'intro' }, 'Choisissez un rendez-vous, réservez votre place en quelques gestes : l\'accès s\'ouvre dès le paiement.'),
    offres.length
      ? el('ul', { class: 'offres' }, offres.map((o) => el('li', {}, el('a', { class: 'carte-offre', href: `#/offre/${o.id}` },
        o.image && el('img', { src: o.image, alt: '', loading: 'lazy' }),
        el('h2', {}, o.titre),
        o.resume && el('p', {}, o.resume),
        meta(o)))))
      : el('p', { class: 'vide' }, 'Aucun rendez-vous ouvert pour le moment.')));
}

// ---------- Formulaire de réservation (offre directe ou lien personnel) ----------

function formulaire({ prix, echeances, email, nom, envoyer, libelle }) {
  const champNom = el('input', { type: 'text', id: 'nom', autocomplete: 'name', required: true, maxlength: 120, value: nom || '' });
  const champEmail = el('input', { type: 'email', id: 'email', autocomplete: 'email', inputmode: 'email', required: true, maxlength: 200, value: email || '', readonly: email ? true : null });
  const champTel = el('input', { type: 'tel', id: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 30 });
  const message = el('p', { class: 'message-erreur', role: 'alert' });
  const trois = echeancier(prix, 3);
  const formules = echeances === 3 && prix > 0 ? el('fieldset', { class: 'formules' },
    el('legend', { class: 'etiquette' }, 'Règlement'),
    el('label', { class: 'formule' }, el('input', { type: 'radio', name: 'echeances', value: '1', checked: true }),
      el('span', {}, el('strong', {}, `En une fois · ${euros(prix)}`))),
    el('label', { class: 'formule' }, el('input', { type: 'radio', name: 'echeances', value: '3' }),
      el('span', {}, el('strong', {}, `En trois fois · ${euros(trois[0])} aujourd'hui`),
        el('span', {}, `puis ${euros(trois[1])} dans un mois et ${euros(trois[2])} dans deux mois, prélevés automatiquement`)))) : null;
  const bouton = el('button', { class: 'bouton large', type: 'submit' }, libelle);

  const actualiserBouton = () => {
    const choix = formules?.querySelector('input:checked')?.value === '3';
    bouton.textContent = prix ? `Payer ${euros(choix ? trois[0] : prix)}` : libelle;
  };
  formules?.addEventListener('change', actualiserBouton);
  actualiserBouton();

  return el('form', {
    class: 'carte', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      message.textContent = '';
      if (!champNom.value.trim()) { message.textContent = 'Indiquez votre nom.'; champNom.focus(); return; }
      if (!EMAIL_VALIDE.test(champEmail.value.trim().toLowerCase())) { message.textContent = 'Vérifiez votre adresse e-mail.'; champEmail.focus(); return; }
      bouton.disabled = true;
      bouton.textContent = 'Un instant…';
      try {
        const { url } = await envoyer({
          nom: champNom.value, email: champEmail.value, telephone: champTel.value,
          echeances: Number(formules?.querySelector('input:checked')?.value || 1),
        });
        location.href = url;
      } catch (erreurEnvoi) {
        message.textContent = erreurEnvoi.message;
        bouton.disabled = false;
        actualiserBouton();
      }
    },
  },
  el('h2', {}, 'Réserver ma place'),
  el('label', { class: 'champ' }, el('span', { class: 'etiquette' }, 'Prénom et nom'), champNom),
  el('label', { class: 'champ' }, el('span', { class: 'etiquette' }, 'E-mail'), champEmail,
    el('span', { class: 'aide' }, 'Votre confirmation et votre accès arrivent à cette adresse.')),
  el('label', { class: 'champ' }, el('span', { class: 'etiquette' }, 'Téléphone (facultatif)'), champTel),
  formules, message, bouton,
  prix > 0 && el('p', { class: 'securite' }, ico('cadenas'), `Paiement sécurisé par Stripe, au nom de ${NOM}`));
}

function infos(o) {
  return el('ul', { class: 'infos' },
    o.dateLisible && el('li', {}, el('span', { class: 'etiquette' }, 'Quand'), el('span', {}, o.dateLisible)),
    o.duree && el('li', {}, el('span', { class: 'etiquette' }, 'Durée'), el('span', {}, o.duree)),
    o.lieu && el('li', {}, el('span', { class: 'etiquette' }, 'Où'), el('span', {}, o.lieu)),
    o.placesRestantes !== null && el('li', {}, el('span', { class: 'etiquette' }, 'Places'),
      el('span', {}, o.complet ? 'Complet' : `${o.placesRestantes} restante${o.placesRestantes > 1 ? 's' : ''}`)));
}

async function vueOffre(id) {
  const o = await api('GET', `boutique/offres/${encodeURIComponent(id)}`);
  let action;
  if (o.paiement === 'invitation') {
    action = el('div', { class: 'carte' },
      el('h2', {}, 'Sur rendez-vous'),
      el('p', {}, `Cet accompagnement commence par un premier échange avec ${NOM}. Vous recevrez ensuite un lien personnel pour confirmer votre inscription.`),
      o.contact && el('a', { class: 'bouton large', href: o.contact, target: '_blank', rel: 'noopener' }, 'Prendre contact'));
  } else if (o.complet) {
    action = el('div', { class: 'carte' }, el('h2', {}, 'C\'est complet'), el('p', { class: 'aide' }, 'Toutes les places sont réservées pour cette date.'));
  } else {
    action = formulaire({
      prix: o.prix, echeances: o.echeances, libelle: 'Confirmer mon inscription',
      envoyer: (donnees) => api('POST', 'boutique/commandes', { ...donnees, offre: o.id }),
    });
  }
  afficher(barre('#/'), el('main', { class: 'page' },
    o.image && el('img', { class: 'banniere', src: o.image, alt: '' }),
    el('p', { class: 'etiquette' }, o.typeLibelle),
    el('h1', {}, o.titre),
    meta(o, false),
    infos(o),
    o.description && el('p', { class: 'description' }, o.description),
    action));
}

async function vueInvitation(jeton) {
  const inv = await api('GET', `boutique/invitations/${encodeURIComponent(jeton)}`);
  const o = inv.offre;
  const fin = inv.utilisee || inv.expiree;
  afficher(barre('#/'), el('main', { class: 'page' },
    el('p', { class: 'etiquette' }, 'Votre lien personnel'),
    el('h1', {}, o.titre),
    el('p', { class: 'intro' }, `${inv.nom ? `${inv.nom}, ` : ''}voici l'accompagnement convenu avec ${NOM}.`),
    infos(o),
    o.description && el('p', { class: 'description' }, o.description),
    fin
      ? el('div', { class: 'carte' }, el('h2', {}, inv.utilisee ? 'Inscription déjà confirmée' : 'Lien expiré'),
        el('p', { class: 'aide' }, inv.utilisee ? 'Retrouvez-la dans votre espace.' : `Demandez un nouveau lien à ${NOM}.`),
        inv.utilisee && el('a', { class: 'bouton large', href: '#/compte' }, 'Mon espace'))
      : formulaire({
        prix: inv.prix, echeances: inv.echeances, email: inv.email, nom: inv.nom, libelle: 'Confirmer mon inscription',
        envoyer: (donnees) => api('POST', 'boutique/commandes', { ...donnees, invitation: jeton }),
      })));
}

// ---------- Paiement simulé (essais sans Stripe) ----------

async function vueSimulation(id, cle) {
  const c = await api('GET', `boutique/commandes/${id}?cle=${encodeURIComponent(cle)}`);
  if (!c.simulation) { location.hash = `#/merci/${id}/${cle}`; return; }
  afficher(barre(), el('main', { class: 'page' }, el('div', { class: 'carte simulation' },
    el('p', { class: 'etiquette' }, 'Mode essai — aucun argent ne circule'),
    el('h1', {}, 'Paiement simulé'),
    el('p', {}, `${c.offre} · ${euros(c.versements[0].montant)}`),
    el('div', { class: 'boutons' },
      el('button', { class: 'bouton large', type: 'button', onclick: async (e) => {
        e.target.disabled = true;
        await api('POST', 'boutique/simulation', { commande: id, cle });
        location.hash = `#/merci/${id}/${cle}`;
      } }, 'Simuler un paiement réussi'),
      el('a', { class: 'bouton discret large', href: '#/' }, 'Annuler')))));
}

// ---------- Retour de paiement ----------

function listeVersements(versements) {
  if (versements.length < 2) return null;
  return el('ul', { class: 'versements' }, versements.map((v) => el('li', { class: v.statut },
    el('span', {}, `Versement ${v.numero} · ${euros(v.montant)}`),
    el('span', {}, v.statut === 'payee' ? '✓ réglé' : v.statut === 'echec' ? 'à régulariser'
      : v.du ? `le ${new Date(v.du).toLocaleDateString('fr-FR')}` : 'à venir'))));
}

async function vueMerci(id, cle, essai = 0) {
  let c = await api('GET', `boutique/commandes/${id}?cle=${encodeURIComponent(cle)}`);
  if (c.statut === 'en-attente') {
    if (essai === 0) afficher(barre(), el('main', { class: 'page centre' }, el('div', { class: 'attente', 'aria-hidden': 'true' }), el('p', {}, 'Confirmation du paiement…')));
    if (essai < 15) { setTimeout(() => { if (location.hash.startsWith(`#/merci/${id}/`)) vueMerci(id, cle, essai + 1).catch((e) => erreur(e.message)); }, 2000); return; }
    afficher(barre(), el('main', { class: 'page centre' }, el('h1', {}, 'Paiement en cours de vérification'),
      el('p', {}, 'Cela prend plus de temps que prévu. Vous recevrez un e-mail dès la confirmation.'),
      el('a', { class: 'bouton secondaire', href: '#/compte' }, 'Mon espace')));
    return;
  }
  if (c.statut === 'expiree') { erreur('Ce paiement n\'a pas abouti. Vous pouvez recommencer.'); return; }

  let note = null;
  if (!c.connecte) {
    try {
      await api('POST', `boutique/commandes/${id}/connexion`, { cle });
      c = { ...c, connecte: true };
    } catch (e) {
      if (e.details?.parLien) note = el('p', { class: 'aide' }, `Vous avez déjà un espace : ouvrez-le avec le lien envoyé à ${c.email}.`);
    }
  }
  afficher(barre(), el('main', { class: 'page centre' },
    el('div', { class: 'sceau' }, ico('coche')),
    el('p', { class: 'etiquette' }, 'Inscription confirmée'),
    el('h1', {}, c.offre),
    el('p', {}, [c.date, c.lieu].filter(Boolean).join(' · ')),
    el('p', { class: 'intro' }, `Merci ${c.nom}. Une confirmation part à ${c.email}.`),
    listeVersements(c.versements),
    c.formations.length > 0 && el('div', { class: 'carte' },
      el('h2', {}, 'Votre accès est ouvert'),
      el('ul', { class: 'liste-acces' }, c.formations.map((f) => el('li', {},
        el('a', { href: `../#/f/${encodeURIComponent(f.id)}` }, f.titre, ico('fleche')))))),
    note,
    el('div', { class: 'boutons' }, el('a', { class: 'bouton secondaire large', href: '#/compte' }, 'Mon espace'))));
}

// ---------- Espace du stagiaire ----------

async function vueCompte() {
  const moi = await api('GET', 'compte');
  if (!moi.connecte) return vueDemandeLien(moi.courriel);
  afficher(barre('#/'), el('main', { class: 'page' },
    el('p', { class: 'etiquette' }, 'Mon espace'),
    el('h1', {}, moi.nom || moi.email),
    el('section', { class: 'carte' },
      el('h2', {}, 'Mes formations'),
      moi.formations.length
        ? el('ul', { class: 'liste-acces' }, moi.formations.map((f) => el('li', {},
          el('a', { href: `../#/f/${encodeURIComponent(f.id)}` }, f.titre, ico('fleche')))))
        : el('p', { class: 'aide' }, 'Aucun module pour le moment. Ils s\'ajoutent ici avec vos inscriptions.')),
    el('section', { class: 'carte' },
      el('h2', {}, 'Mes inscriptions'),
      moi.inscriptions.length
        ? moi.inscriptions.map((i) => el('div', { class: 'inscription' },
          el('h3', {}, i.offre),
          el('p', { class: 'aide' }, [i.date, i.lieu].filter(Boolean).join(' · '),
            i.statut === 'retiree' ? ' · annulée' : ''),
          listeVersements(i.versements)))
        : el('p', { class: 'aide' }, 'Pas encore d\'inscription.'),
      el('a', { class: 'bouton secondaire large', href: '#/' }, 'Voir les rendez-vous')),
    el('button', { class: 'bouton discret large', type: 'button', onclick: async () => {
      await api('POST', 'compte/deconnexion');
      vueCompte();
    } }, 'Se déconnecter')));
}

function vueDemandeLien(courrielActif) {
  const champ = el('input', { type: 'email', id: 'email', autocomplete: 'email', inputmode: 'email', required: true });
  const message = el('p', { class: 'message-erreur', role: 'alert' });
  const bouton = el('button', { class: 'bouton large', type: 'submit' }, 'Recevoir mon lien');
  afficher(barre('#/'), el('main', { class: 'page' },
    el('p', { class: 'etiquette' }, 'Mon espace'),
    el('h1', {}, 'Se connecter'),
    el('p', { class: 'intro' }, 'Pas de mot de passe : indiquez l\'adresse utilisée lors de votre inscription, un lien de connexion vous est envoyé.'),
    el('form', {
      class: 'carte', novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        message.textContent = '';
        if (!EMAIL_VALIDE.test(champ.value.trim().toLowerCase())) { message.textContent = 'Vérifiez votre adresse e-mail.'; return; }
        bouton.disabled = true;
        try {
          await api('POST', 'compte/lien', { email: champ.value });
          e.target.replaceChildren(el('h2', {}, 'Regardez vos e-mails'),
            el('p', {}, `Si ${champ.value.trim()} correspond à une inscription, un lien vient de partir. Il est valable 20 minutes.`),
            el('p', { class: 'aide' }, 'Pensez à vérifier les courriers indésirables.'));
        } catch (erreurEnvoi) {
          message.textContent = erreurEnvoi.message;
          bouton.disabled = false;
        }
      },
    }, el('label', { class: 'champ' }, el('span', { class: 'etiquette' }, 'E-mail'), champ), message, bouton,
    !courrielActif && el('p', { class: 'aide' }, `L'envoi d'e-mails n'est pas encore branché : demandez votre lien à ${NOM}.`))));
  champ.focus();
}

async function vueConnexion(jeton) {
  try {
    await api('POST', 'compte/connexion', { jeton });
    history.replaceState(null, '', '#/compte');
    annoncer('Vous êtes connecté·e.');
    await vueCompte();
  } catch (e) {
    afficher(barre('#/'), el('main', { class: 'page' }, el('h1', {}, 'Lien expiré'), el('p', {}, e.message),
      el('a', { class: 'bouton large', href: '#/compte' }, 'Demander un nouveau lien')));
  }
}

// ---------- Navigation ----------

function routeur() {
  toast.classList.remove('visible');
  const [vue, a, b] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const rendu = {
    offre: () => vueOffre(a),
    invitation: () => vueInvitation(a),
    simulation: () => vueSimulation(a, b),
    merci: () => vueMerci(a, b),
    compte: () => vueCompte(),
    connexion: () => vueConnexion(a),
  }[vue] || vueOffres;
  Promise.resolve().then(rendu).catch((e) => { console.error(e); erreur(e.message); });
}

window.addEventListener('hashchange', routeur);
routeur();
