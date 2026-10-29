// Boutique de l'organisatrice (Maât Soby) : offres reliées à l'agenda, paiement Stripe à son nom
// avec la commission de la plateforme, comptes stagiaires par lien de connexion, accès ouverts
// automatiquement aux formations liées à une offre.
//
// Variables d'environnement (toutes facultatives ; sans clé Stripe, seules les offres gratuites
// se réservent) :
//   FORMATION_URL_PUBLIQUE     adresse publique du site (ex. https://akasha-formation.nubitech.org)
//   STRIPE_CLE_SECRETE         clé secrète du compte Stripe de la plateforme (sk_test_… ou sk_live_…)
//   STRIPE_COMPTE              compte Stripe connecté de l'organisatrice (acct_…) qui encaisse
//   STRIPE_SECRET_WEBHOOK      secret de signature du webhook (whsec_…)
//   BOUTIQUE_COMMISSION        commission de la plateforme, en % de chaque paiement (défaut : 10)
//   BOUTIQUE_FORFAIT          forfait mensuel de la plateforme, en centimes (défaut : 2500 = 25 €)
//   BOUTIQUE_FORFAIT_DEBUT    premier mois facturé (AAAA-MM) ; vide = pas encore de forfait
//   BOUTIQUE_NOM               nom affiché (défaut : Maât Soby)
//   BOUTIQUE_COURRIEL_WEBHOOK  webhook (n8n) qui envoie les e-mails : reçoit { a, sujet, texte, html }
//   BOUTIQUE_COURRIEL_SECRET   secret partagé avec ce webhook (en-tête X-Courriel-Secret)
//   BOUTIQUE_COURRIEL_ADMIN    adresse prévenue à chaque inscription
//   BOUTIQUE_CONTACT           contact par défaut (ex. https://wa.me/590…) : sert aussi à réserver tant que le
//                              paiement en ligne n'est pas ouvert
//   BOUTIQUE_ORIGINES          sites autorisés à lire la liste des offres (défaut : https://maatsoby.nubitech.org)
//   BOUTIQUE_SIMULATION=1      paiements simulés, pour essayer sans Stripe (jamais en production)

import { randomBytes, createHash } from 'node:crypto';
import { join } from 'node:path';
import { envoyer, ErreurHttp, lireCorps, lireJson, lireCookie } from './http.js';
import { creerMagasin } from './stockage.js';
import { creerStripe, verifierSignature } from './stripe.js';
import { creerCourriel } from './courriel.js';
import { fichierIcs, debutDe } from './agenda.js';
import {
  normaliserOffre, verifierOffre, echeancier, commissionSur, euros, dateLisible,
  EMAIL_VALIDE, normaliserEmail, TYPES_OFFRE,
} from '../public/commun/offres.js';
import { idUnique } from '../public/commun/valider.js';

const JOUR = 24 * 3600 * 1000;
const DUREE_SESSION = 30 * JOUR;
const DUREE_LIEN = 20 * 60 * 1000;
const DUREE_LIEN_CONFIRMATION = 3 * JOUR;
const DUREE_INVITATION = 30 * JOUR;
// Stripe garde une page de paiement ouverte au moins 30 minutes : la place reste réservée autant.
const DUREE_RESERVATION = 32 * 60 * 1000;
const EVENEMENTS_GARDES = 1000;
// Le rappel part dans les 26 heures qui précèdent le rendez-vous (vérification toutes les heures).
const FENETRE_RAPPEL = 26 * 3600 * 1000;
const ACTIVES = new Set(['payee', 'en-cours']);

const hacher = (t) => createHash('sha256').update(String(t)).digest('hex');
const jeton = (octets = 24) => randomBytes(octets).toString('base64url');
const maintenant = () => new Date().toISOString();
const echapper = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function ajouterMois(iso, n) {
  const d = new Date(iso);
  const jour = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() !== jour) d.setUTCDate(0); // 31 janvier + 1 mois → fin février
  return d.toISOString();
}

const dateCourte = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export function creerBoutique(ctx) {
  const env = process.env;
  const config = {
    url: (env.FORMATION_URL_PUBLIQUE || '').replace(/\/+$/, ''),
    nom: env.BOUTIQUE_NOM || 'Maât Soby',
    commission: Math.min(100, Math.max(0, Number(env.BOUTIQUE_COMMISSION ?? 10) || 0)),
    compte: env.STRIPE_COMPTE || '',
    secretWebhook: env.STRIPE_SECRET_WEBHOOK || '',
    adminCourriel: env.BOUTIQUE_COURRIEL_ADMIN || '',
    forfait: Math.max(0, Math.round(Number(env.BOUTIQUE_FORFAIT ?? 2500) || 0)),
    contact: /^(https:\/\/|mailto:|tel:)\S+$/.test(env.BOUTIQUE_CONTACT || '') ? env.BOUTIQUE_CONTACT : '',
    forfaitDebut: /^\d{4}-\d{2}$/.test(env.BOUTIQUE_FORFAIT_DEBUT || '') ? env.BOUTIQUE_FORFAIT_DEBUT : '',
    origines: (env.BOUTIQUE_ORIGINES ?? 'https://maatsoby.nubitech.org').split(',').map((s) => s.trim()).filter(Boolean),
    simulation: env.BOUTIQUE_SIMULATION === '1' && !env.STRIPE_CLE_SECRETE,
  };
  const stripe = env.STRIPE_CLE_SECRETE
    ? creerStripe({ cle: env.STRIPE_CLE_SECRETE, compte: config.compte, base: env.STRIPE_API || undefined })
    : null;
  const courriel = creerCourriel({ webhook: env.BOUTIQUE_COURRIEL_WEBHOOK, secret: env.BOUTIQUE_COURRIEL_SECRET, journaliserLiens: config.simulation });
  const magasin = creerMagasin(join(ctx.donnees, 'boutique'));
  const modePaiement = stripe ? (stripe.modeTest ? 'test' : 'reel') : config.simulation ? 'simulation' : 'aucun';

  // ---------- Outils ----------

  function base(req) {
    if (config.url) return config.url;
    const proto = ctx.viaProxyLocal(req) && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    return `${proto}://${req.headers.host || `127.0.0.1:${ctx.port}`}`;
  }

  const essais = new Map();
  function limiter(req, type, max, fenetre) {
    const cle = `${type}:${ctx.adresseClient(req)}`;
    const t = essais.get(cle);
    const actuel = t && Date.now() - t.depuis < fenetre ? t : { n: 0, depuis: Date.now() };
    if (actuel.n >= max) throw new ErreurHttp(429, 'Trop de demandes. Réessayez dans un quart d\'heure.');
    essais.set(cle, { ...actuel, n: actuel.n + 1 });
  }

  // Écritures publiques : seulement depuis nos propres pages (bloque les formulaires d'autres sites).
  function exigerOrigine(req) {
    if (req.headers['x-requested-with'] !== 'boutique') throw new ErreurHttp(403, 'Requête refusée.');
  }

  const lireOffres = () => magasin.lire('offres', []);
  const lireCommandes = () => magasin.lire('commandes', []);
  const lireStagiaires = () => magasin.lire('stagiaires', []);

  function reservees(commandes, offreId) {
    const limite = Date.now() - DUREE_RESERVATION;
    return commandes.filter((c) => c.offre === offreId
      && (ACTIVES.has(c.statut) || (c.statut === 'en-attente' && Date.parse(c.creeLe) > limite))).length;
  }
  const placesRestantes = (o, commandes) => (o.places ? Math.max(0, o.places - reservees(commandes, o.id)) : null);
  const passee = (o) => Boolean(o.date) && Date.parse(o.date.length === 10 ? `${o.date}T23:59` : o.date) < Date.now();

  function offrePublique(o, commandes, req) {
    const restantes = placesRestantes(o, commandes);
    return {
      id: o.id, titre: o.titre, type: o.type, typeLibelle: TYPES_OFFRE[o.type], resume: o.resume,
      description: o.description, image: o.image ? `${base(req)}/${o.image}` : '', date: o.date,
      dateLisible: dateLisible(o.date), duree: o.duree, lieu: o.lieu, prix: o.prix, prixLisible: euros(o.prix),
      echeances: o.echeances, paiement: o.paiement, placesRestantes: restantes, complet: restantes === 0,
      passee: passee(o), contact: o.contact || config.contact,
      // Paiement en ligne pas encore ouvert : une offre payante se réserve par le contact.
      reservationEnLigne: o.prix === 0 || modePaiement !== 'aucun',
      url: `${base(req)}/boutique/#/offre/${o.id}`,
      agenda: o.date ? `${base(req)}/api/boutique/offres/${o.id}/agenda.ics` : '',
    };
  }

  // Les offres à venir d'abord, par date ; les offres sans date ensuite.
  const ordreOffres = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.titre.localeCompare(b.titre, 'fr');

  function cookieStagiaire(req, valeur, duree) {
    const securise = ctx.cookieSecurise(req) ? '; Secure' : '';
    return `stagiaire_session=${valeur}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(duree / 1000)}${securise}`;
  }

  async function ouvrirSession(req, stagiaireId) {
    const t = jeton(32);
    await magasin.modifier('sessions', {}, (sessions) => {
      for (const [k, s] of Object.entries(sessions)) if (Date.parse(s.expire) < Date.now()) delete sessions[k];
      sessions[hacher(t)] = { stagiaire: stagiaireId, expire: new Date(Date.now() + DUREE_SESSION).toISOString() };
    });
    return cookieStagiaire(req, t, DUREE_SESSION);
  }

  async function stagiaireConnecte(req) {
    const t = lireCookie(req, 'stagiaire_session');
    if (!t) return null;
    const s = (await magasin.lire('sessions', {}))[hacher(t)];
    if (!s || Date.parse(s.expire) < Date.now()) return null;
    return (await lireStagiaires()).find((x) => x.id === s.stagiaire) || null;
  }

  async function formationsDe(stagiaire) {
    const ids = new Set();
    if (!stagiaire) return ids;
    const [commandes, offres] = await Promise.all([lireCommandes(), lireOffres()]);
    for (const id of stagiaire.accesManuels || []) ids.add(id);
    for (const c of commandes) {
      if (c.stagiaire !== stagiaire.id || !ACTIVES.has(c.statut)) continue;
      // Les formations prévues à l'achat, plus celles ajoutées depuis à l'offre (module de préparation…).
      for (const id of c.formations || []) ids.add(id);
      for (const id of offres.find((o) => o.id === c.offre)?.formations || []) ids.add(id);
    }
    return ids;
  }

  async function trouverOuCreerStagiaire({ email, nom, telephone }) {
    return magasin.modifier('stagiaires', [], (liste) => {
      let s = liste.find((x) => x.email === email);
      if (s) {
        if (!s.nom && nom) s.nom = nom;
        if (!s.telephone && telephone) s.telephone = telephone;
        return { stagiaire: structuredClone(s), cree: false };
      }
      s = { id: `s-${randomBytes(6).toString('hex')}`, email, nom, telephone: telephone || '', creeLe: maintenant(), accesManuels: [] };
      liste.push(s);
      return { stagiaire: structuredClone(s), cree: true };
    });
  }

  async function lienConnexion(req, stagiaireId, duree) {
    const t = jeton(32);
    await magasin.modifier('liens', {}, (liens) => {
      for (const [k, l] of Object.entries(liens)) if (Date.parse(l.expire) < Date.now()) delete liens[k];
      liens[hacher(t)] = { stagiaire: stagiaireId, expire: new Date(Date.now() + duree).toISOString() };
    });
    return `${base(req)}/boutique/#/connexion/${t}`;
  }

  function message(lignes, lien, libelleLien) {
    const texte = [...lignes.filter(Boolean), '', lien ? `${libelleLien} : ${lien}` : '', '', `— ${config.nom}`].join('\n');
    const html = `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.55;color:#1d1b18">${
      lignes.map((l) => (l ? `<p style="margin:0 0 .8em">${echapper(l)}</p>` : '')).join('')
    }${lien ? `<p style="margin:1.4em 0"><a href="${echapper(lien)}" style="background:#b8913a;color:#0a0d12;padding:.7em 1.2em;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold">${echapper(libelleLien)}</a></p>` : ''
    }<p style="color:#6b6458">— ${echapper(config.nom)}</p></div>`;
    return { texte, html };
  }

  // ---------- Commandes et paiements ----------

  async function modifierCommande(id, changer) {
    return magasin.modifier('commandes', [], (liste) => {
      const c = liste.find((x) => x.id === id);
      return c ? structuredClone(changer(c) ?? c) : null;
    });
  }

  // Enregistre un versement (idempotent : un versement déjà payé est ignoré).
  async function validerPaiement(req, id, { echeance = 1, paymentIntent, client, moyen } = {}) {
    let nouveau = false;
    const c = await modifierCommande(id, (cmd) => {
      const e = cmd.echeances.find((x) => x.numero === echeance);
      if (!e || e.statut === 'payee') return cmd;
      nouveau = true;
      e.statut = 'payee';
      e.paye = maintenant();
      delete e.erreur;
      if (paymentIntent) e.paymentIntent = paymentIntent;
      if (client) cmd.stripeClient = client;
      if (moyen) cmd.stripeMoyen = moyen;
      if (echeance === 1) {
        for (const x of cmd.echeances) if (x.numero > 1) x.du = ajouterMois(e.paye, x.numero - 1);
      }
      if (cmd.statut !== 'retiree') cmd.statut = cmd.echeances.every((x) => x.statut === 'payee') ? 'payee' : 'en-cours';
      return cmd;
    });
    if (!c || !nouveau) return c;

    if (echeance === 1) {
      const { stagiaire, cree } = await trouverOuCreerStagiaire(c);
      await modifierCommande(id, (cmd) => { cmd.stagiaire = stagiaire.id; cmd.compteCree = cree; });
      if (c.invitation) {
        await magasin.modifier('invitations', [], (liste) => {
          const inv = liste.find((x) => x.jeton === c.invitation);
          if (inv) inv.utiliseeLe = maintenant();
        });
      }
      const suite = c.echeances.filter((x) => x.numero > 1);
      const { texte, html } = message([
        `Bonjour ${c.nom},`,
        c.total ? `Votre paiement de ${euros(c.echeances[0].montant)} est bien reçu : votre inscription à « ${c.offreTitre} » est confirmée.`
          : `Votre inscription à « ${c.offreTitre} » est confirmée.`,
        [dateLisible(c.offreDate), c.offreLieu].filter(Boolean).join(' · '),
        suite.length ? `Prochains versements : ${suite.map((x) => `${euros(x.montant)} le ${dateCourte(x.du)}`).join(', ')}, prélevés automatiquement sur la même carte.` : '',
        c.formations?.length ? 'Votre espace vous donne accès au module de formation lié à cette inscription.' : '',
        c.offreDate ? `Ajouter à votre agenda : ${base(req)}/api/boutique/offres/${c.offre}/agenda.ics` : '',
      ], await lienConnexion(req, stagiaire.id, DUREE_LIEN_CONFIRMATION), 'Ouvrir mon espace');
      courriel.envoyer({ a: c.email, sujet: `Inscription confirmée : ${c.offreTitre}`, texte, html });
      if (config.adminCourriel) {
        courriel.envoyer({
          a: config.adminCourriel,
          sujet: `Nouvelle inscription : ${c.offreTitre}`,
          texte: `${c.nom} <${c.email}>${c.telephone ? ` · ${c.telephone}` : ''}\n${c.offreTitre} · ${euros(c.total)}${c.echeances.length > 1 ? ' en 3 fois' : ''}`,
        });
      }
    } else {
      const { texte, html } = message([
        `Bonjour ${c.nom},`,
        `Le versement ${echeance} sur ${c.echeances.length} (${euros(c.echeances[echeance - 1].montant)}) pour « ${c.offreTitre} » est bien reçu. Merci.`,
      ]);
      courriel.envoyer({ a: c.email, sujet: `Versement reçu : ${c.offreTitre}`, texte, html });
    }
    return c;
  }

  async function marquerEchec(req, id, echeance, raison) {
    const c = await modifierCommande(id, (cmd) => {
      const e = cmd.echeances.find((x) => x.numero === echeance);
      if (e && e.statut !== 'payee') { e.statut = 'echec'; e.erreur = String(raison || '').slice(0, 300); e.essais = (e.essais || 0) + 1; }
    });
    if (!c) return;
    const { texte, html } = message([
      `Bonjour ${c.nom},`,
      `Le versement ${echeance} sur ${c.echeances.length} pour « ${c.offreTitre} » n'a pas pu être prélevé (${raison || 'carte refusée'}).`,
      `${config.nom} va reprendre contact avec vous pour le régler.`,
    ]);
    courriel.envoyer({ a: c.email, sujet: `Versement non abouti : ${c.offreTitre}`, texte, html });
    if (config.adminCourriel) {
      courriel.envoyer({ a: config.adminCourriel, sujet: `Versement refusé : ${c.nom}`, texte: `${c.offreTitre} · versement ${echeance} · ${raison || ''}` });
    }
  }

  // Une session Checkout payée (reçue par webhook ou vérifiée au retour du stagiaire).
  async function sessionPayee(req, session) {
    const id = session.metadata?.commande || session.client_reference_id;
    if (!id || session.payment_status !== 'paid') return;
    let pi = session.payment_intent;
    if (typeof pi === 'string') pi = await stripe.appel('GET', `payment_intents/${pi}`);
    await validerPaiement(req, id, {
      echeance: 1, paymentIntent: pi?.id, client: session.customer || pi?.customer,
      moyen: typeof pi?.payment_method === 'string' ? pi.payment_method : pi?.payment_method?.id,
    });
  }

  async function expirer(id) {
    await modifierCommande(id, (c) => { if (c.statut === 'en-attente') c.statut = 'expiree'; });
    prevenirAttente().catch((e) => console.error('Liste d\'attente :', e));
  }

  // ---------- Rappels et liste d'attente ----------

  // La veille : un e-mail de rappel à chaque inscrit (une seule fois par inscription).
  async function envoyerRappels() {
    const req = { headers: {}, socket: {} };
    const offres = await lireOffres();
    for (const c of await lireCommandes()) {
      if (!ACTIVES.has(c.statut) || c.rappel) continue;
      const o = offres.find((x) => x.id === c.offre);
      const date = o?.date || c.offreDate;
      const debut = debutDe(date);
      if (!debut || debut <= Date.now() || debut - Date.now() > FENETRE_RAPPEL) continue;
      // Inscrit au dernier moment : la confirmation vient de partir, pas besoin de rappel.
      const inscrit = Date.parse(c.echeances[0]?.paye || c.creeLe);
      const marque = inscrit > debut - FENETRE_RAPPEL ? 'inutile' : maintenant();
      await modifierCommande(c.id, (cmd) => { cmd.rappel = marque; });
      if (marque === 'inutile') continue;
      const lieu = o?.lieu || c.offreLieu;
      const { texte, html } = message([
        `Bonjour ${c.nom},`,
        `Petit rappel : « ${o?.titre || c.offreTitre} », c'est ${dateLisible(date)}.`,
        lieu ? `Lieu : ${lieu}` : '',
        'À très vite.',
      ], `${base(req)}/boutique/#/compte`, 'Mon espace');
      courriel.envoyer({ a: c.email, sujet: `Rappel : ${o?.titre || c.offreTitre}`, texte, html });
    }
  }

  // Une place libre ? On prévient, dans l'ordre d'arrivée, autant de personnes que de places.
  async function prevenirAttente() {
    const req = { headers: {}, socket: {} };
    const [offres, commandes, attente] = await Promise.all([lireOffres(), lireCommandes(), magasin.lire('attente', [])]);
    const aPrevenir = [];
    for (const o of offres) {
      if (!o.publie || passee(o) || !o.places) continue;
      const restantes = placesRestantes(o, commandes);
      if (!restantes) continue;
      const inscrits = new Set(commandes.filter((c) => c.offre === o.id && ACTIVES.has(c.statut)).map((c) => c.email));
      attente.filter((a) => a.offre === o.id && !a.prevenuLe && !inscrits.has(a.email))
        .sort((a, b) => a.creeLe.localeCompare(b.creeLe)).slice(0, restantes)
        .forEach((a) => aPrevenir.push({ a, o }));
    }
    if (!aPrevenir.length) return;
    const ids = new Set(aPrevenir.map(({ a }) => a.id));
    await magasin.modifier('attente', [], (liste) => {
      for (const a of liste) if (ids.has(a.id)) a.prevenuLe = maintenant();
    });
    for (const { a, o } of aPrevenir) {
      const { texte, html } = message([
        `Bonjour ${a.nom},`,
        `Une place vient de se libérer pour « ${o.titre} » (${dateLisible(o.date)}).`,
        'Elle revient à la première personne qui la réserve.',
      ], `${base(req)}/boutique/#/offre/${o.id}`, 'Réserver ma place');
      courriel.envoyer({ a: a.email, sujet: `Une place s'est libérée : ${o.titre}`, texte, html });
    }
  }

  // Au retour du stagiaire, si le webhook n'est pas encore passé, on demande directement à Stripe.
  const verifications = new Map();
  async function synchroniser(req, c) {
    if (!stripe || c.statut !== 'en-attente' || !c.stripeSession) return;
    if (Date.now() - (verifications.get(c.id) || 0) < 2500) return;
    verifications.set(c.id, Date.now());
    try {
      const session = await stripe.appel('GET', `checkout/sessions/${c.stripeSession}`, { expand: ['payment_intent'] });
      if (session.payment_status === 'paid') await sessionPayee(req, session);
      else if (session.status === 'expired') await expirer(c.id);
    } catch (e) {
      console.error('Vérification Stripe impossible :', e.message);
    }
  }

  // Versements 2 et 3 : prélevés à leur date sur la carte enregistrée au premier paiement.
  async function preleverEcheances() {
    const req = { headers: {}, socket: {} };
    for (const c of await lireCommandes()) {
      if (c.statut !== 'en-cours') continue;
      for (const e of c.echeances) {
        if (e.statut === 'tentative' && Date.now() - Date.parse(e.tente) > 15 * 60 * 1000) e.statut = 'a-venir';
        if (e.statut !== 'a-venir' || !e.du || Date.parse(e.du) > Date.now()) continue;
        if (c.mode === 'simulation') { await validerPaiement(req, c.id, { echeance: e.numero }); continue; }
        if (c.mode !== 'stripe' || !stripe || !c.stripeClient || !c.stripeMoyen) continue;
        await modifierCommande(c.id, (cmd) => {
          const x = cmd.echeances.find((y) => y.numero === e.numero);
          x.statut = 'tentative';
          x.tente = maintenant();
        });
        try {
          const pi = await stripe.appel('POST', 'payment_intents', {
            amount: e.montant, currency: 'eur', customer: c.stripeClient, payment_method: c.stripeMoyen,
            off_session: true, confirm: true, description: `${c.offreTitre} — versement ${e.numero} sur ${c.echeances.length}`,
            ...(config.compte ? { application_fee_amount: commissionSur(e.montant, c.commissionPourcent) } : {}),
            metadata: { commande: c.id, echeance: e.numero },
          }, { idempotence: `${c.id}-versement-${e.numero}-${e.essais || 0}` });
          if (pi.status === 'succeeded') await validerPaiement(req, c.id, { echeance: e.numero, paymentIntent: pi.id });
        } catch (err) {
          await marquerEchec(req, c.id, e.numero, err.message);
        }
      }
    }
  }

  async function creerCommande(req, corps) {
    limiter(req, 'commande', 10, 15 * 60 * 1000);
    const offres = await lireOffres();
    let o;
    let invitation = null;
    let { email, nom } = corps;
    let prix;
    let echeancesPermises;

    if (corps.invitation) {
      invitation = (await magasin.lire('invitations', [])).find((x) => x.jeton === String(corps.invitation));
      if (!invitation || invitation.utiliseeLe || invitation.annuleeLe || Date.parse(invitation.expire) < Date.now()) {
        throw new ErreurHttp(410, 'Ce lien personnel n\'est plus valable. Demandez-en un nouveau.');
      }
      o = offres.find((x) => x.id === invitation.offre);
      ({ email } = invitation);
      nom = invitation.nom || nom;
      prix = invitation.prix;
      echeancesPermises = invitation.echeances;
    } else {
      o = offres.find((x) => x.id === corps.offre && x.publie);
      if (o && o.paiement !== 'direct') throw new ErreurHttp(403, `Cette offre se réserve après un premier échange avec ${config.nom}.`);
      prix = o?.prix;
      echeancesPermises = o?.echeances;
    }
    if (!o) throw new ErreurHttp(404, 'Offre introuvable.');
    if (passee(o)) throw new ErreurHttp(410, 'Cette date est passée.');

    email = normaliserEmail(email);
    nom = typeof nom === 'string' ? nom.trim().slice(0, 120) : '';
    const telephone = typeof corps.telephone === 'string' ? corps.telephone.replace(/[^\d+ ().-]/g, '').slice(0, 30) : '';
    if (!nom) throw new ErreurHttp(400, 'Indiquez votre nom.');
    if (!EMAIL_VALIDE.test(email)) throw new ErreurHttp(400, 'Adresse e-mail invalide.');
    if (prix > 0 && modePaiement === 'aucun') throw new ErreurHttp(503, 'Le paiement en ligne n\'est pas encore ouvert. Revenez bientôt.');

    const nombre = echeancesPermises === 3 && Number(corps.echeances) === 3 ? 3 : 1;
    const montants = prix > 0 ? echeancier(prix, nombre) : [0];
    const id = `c-${randomBytes(6).toString('hex')}`;
    const cle = jeton();
    const mode = prix === 0 ? 'gratuit' : stripe ? 'stripe' : 'simulation';

    await magasin.modifier('commandes', [], (liste) => {
      if (placesRestantes(o, liste) === 0) throw new ErreurHttp(409, 'C\'est complet : il ne reste plus de place.');
      liste.push({
        id, offre: o.id, offreTitre: o.titre, offreDate: o.date, offreLieu: o.lieu, formations: o.formations,
        invitation: invitation?.jeton || '', email, nom, telephone, stagiaire: '', total: prix, mode,
        commissionPourcent: config.commission,
        echeances: montants.map((m, i) => ({ numero: i + 1, montant: m, statut: 'a-venir', du: i === 0 ? maintenant() : '' })),
        statut: 'en-attente', cle: hacher(cle), creeLe: maintenant(), stripeSession: '',
      });
    });

    const merci = `${base(req)}/boutique/#/merci/${id}/${cle}`;
    if (mode === 'gratuit') {
      await validerPaiement(req, id, { echeance: 1 });
      return { url: merci };
    }
    if (mode === 'simulation') return { url: `${base(req)}/boutique/#/simulation/${id}/${cle}` };

    const detail = [dateLisible(o.date), o.lieu].filter(Boolean).join(' · ');
    try {
      const session = await stripe.appel('POST', 'checkout/sessions', {
        mode: 'payment', locale: 'fr', customer_email: email, customer_creation: 'always',
        client_reference_id: id, metadata: { commande: id },
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'eur', unit_amount: montants[0],
            product_data: { name: nombre === 3 ? `${o.titre} — 1er versement sur 3` : o.titre, ...(detail ? { description: detail } : {}) },
          },
        }],
        payment_intent_data: {
          description: o.titre,
          metadata: { commande: id, echeance: 1 },
          ...(config.compte ? { application_fee_amount: commissionSur(montants[0], config.commission) } : {}),
          ...(nombre === 3 ? { setup_future_usage: 'off_session' } : {}),
        },
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
        success_url: merci,
        cancel_url: `${base(req)}/boutique/#/${invitation ? `invitation/${invitation.jeton}` : `offre/${o.id}`}`,
      }, { idempotence: `commande-${id}` });
      await modifierCommande(id, (c) => { c.stripeSession = session.id; });
      return { url: session.url };
    } catch (e) {
      await expirer(id);
      console.error('Création de la session Stripe impossible :', e.message);
      throw new ErreurHttp(502, 'Le paiement n\'a pas pu être préparé. Réessayez dans un instant.');
    }
  }

  async function commandeAvecCle(id, cle) {
    const c = (await lireCommandes()).find((x) => x.id === id);
    if (!c || typeof cle !== 'string' || hacher(cle) !== c.cle) throw new ErreurHttp(404, 'Inscription introuvable.');
    return c;
  }

  async function formationsTitrees(ids) {
    const titres = [];
    for (const id of ids) {
      const f = await ctx.lireFormation(id);
      if (f) titres.push({ id: f.id, titre: f.titre });
    }
    return titres;
  }

  const versementsPublics = (c) => c.echeances.map(({ numero, montant, statut, du, paye }) => ({ numero, montant, statut, du, paye }));

  // ---------- Webhook Stripe ----------

  async function webhook(req, res) {
    const brut = await lireCorps(req, 1024 * 1024);
    if (!stripe || !config.secretWebhook) throw new ErreurHttp(503, 'Webhook non configuré.');
    if (!verifierSignature(brut, req.headers['stripe-signature'], config.secretWebhook)) {
      throw new ErreurHttp(400, 'Signature invalide.');
    }
    const ev = JSON.parse(brut.toString('utf8'));
    if (config.compte && ev.account && ev.account !== config.compte) return envoyer(res, 200, { ignore: true });
    if ((await magasin.lire('evenements', [])).includes(ev.id)) return envoyer(res, 200, { deja: true });

    const objet = ev.data?.object || {};
    const versement = Number(objet.metadata?.echeance);
    switch (ev.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await sessionPayee(req, objet);
        break;
      case 'checkout.session.expired':
        if (objet.metadata?.commande) await expirer(objet.metadata.commande);
        break;
      case 'payment_intent.succeeded':
        if (versement > 1) await validerPaiement(req, objet.metadata.commande, { echeance: versement, paymentIntent: objet.id });
        break;
      case 'payment_intent.payment_failed':
        if (versement > 1) await marquerEchec(req, objet.metadata.commande, versement, objet.last_payment_error?.message);
        break;
      default:
        break;
    }
    await magasin.modifier('evenements', [], (liste) => {
      liste.push(ev.id);
      if (liste.length > EVENEMENTS_GARDES) liste.splice(0, liste.length - EVENEMENTS_GARDES);
    });
    return envoyer(res, 200, { recu: true });
  }

  // ---------- Back-office ----------

  async function routerAdmin(req, res, chemin, url) {
    const m = (motif) => chemin.match(motif);
    let p;

    // Suivi de facturation de la plateforme : un versement compte dans le mois où il a été payé.
    if (req.method === 'GET' && (chemin === '/api/admin/boutique/facturation' || chemin === '/api/admin/boutique/facturation.csv')) {
      const annee = /^\d{4}$/.test(url.searchParams.get('annee') || '') ? url.searchParams.get('annee') : String(new Date().getFullYear());
      const lignes = [];
      for (const c of await lireCommandes()) {
        if (!['stripe', 'simulation', 'hors-ligne'].includes(c.mode)) continue;
        for (const e of c.echeances) {
          if (e.statut !== 'payee' || !e.paye?.startsWith(annee) || !e.montant) continue;
          lignes.push({
            date: e.paye, mois: e.paye.slice(0, 7), nom: c.nom, email: c.email, offre: c.offreTitre, mode: c.mode,
            versement: `${e.numero}/${c.echeances.length}`, montant: e.montant,
            commission: commissionSur(e.montant, c.commissionPourcent), statut: c.statut,
          });
        }
      }
      lignes.sort((a, b) => a.date.localeCompare(b.date));
      if (chemin.endsWith('.csv')) {
        const nombre = (c) => (c / 100).toFixed(2).replace('.', ',');
        const champ = (v) => `"${String(v).replace(/"/g, '""')}"`;
        const MODES_CSV = { stripe: 'Carte (Stripe)', simulation: 'Essai (simulé)', 'hors-ligne': 'Hors ligne' };
        const csv = [
          ['Date', 'Client', 'E-mail', 'Offre', 'Mode', 'Versement', 'Montant (€)', `Commission ${config.commission} % (€)`, 'Statut'].map(champ).join(';'),
          ...lignes.map((l) => [l.date.slice(0, 10), l.nom, l.email, l.offre, MODES_CSV[l.mode], l.versement, nombre(l.montant), nombre(l.commission), l.statut].map(champ).join(';')),
        ].join('\r\n');
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="facturation-${annee}.csv"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(`\ufeff${csv}\r\n`); // BOM : Excel reconnaît les accents
        return;
      }
      const mois = Array.from({ length: 12 }, (_, i) => {
        const cle = `${annee}-${String(i + 1).padStart(2, '0')}`;
        const duMois = lignes.filter((l) => l.mois === cle);
        const somme = (mode, champ) => duMois.filter((l) => l.mode === mode).reduce((t, l) => t + l[champ], 0);
        const forfait = config.forfaitDebut && cle >= config.forfaitDebut && cle <= new Date().toISOString().slice(0, 7) ? config.forfait : 0;
        const commissionHorsLigne = somme('hors-ligne', 'commission');
        return {
          mois: cle, encaisse: somme('stripe', 'montant'), commission: somme('stripe', 'commission'),
          horsLigne: somme('hors-ligne', 'montant'), commissionHorsLigne, forfait,
          aFacturer: forfait + commissionHorsLigne,
          essais: somme('simulation', 'montant'),
        };
      });
      return envoyer(res, 200, {
        annee, commission: config.commission, forfait: config.forfait, forfaitDebut: config.forfaitDebut, mois,
        annees: [...new Set([String(new Date().getFullYear()), ...(await lireCommandes()).map((c) => c.creeLe.slice(0, 4))])].sort(),
      });
    }

    if (req.method === 'GET' && chemin === '/api/admin/boutique/etat') {
      return envoyer(res, 200, {
        paiement: modePaiement, compteRelie: Boolean(config.compte), webhook: Boolean(config.secretWebhook),
        courriel: courriel.actif, commission: config.commission, nom: config.nom, url: base(req),
      });
    }

    if (req.method === 'GET' && chemin === '/api/admin/boutique/offres') {
      const [offres, commandes, attente] = await Promise.all([lireOffres(), lireCommandes(), magasin.lire('attente', [])]);
      return envoyer(res, 200, offres.sort(ordreOffres).map((o) => ({
        ...o,
        inscrits: commandes.filter((c) => c.offre === o.id && ACTIVES.has(c.statut)).length,
        enAttente: attente.filter((a) => a.offre === o.id && !a.prevenuLe).length,
        placesRestantes: placesRestantes(o, commandes),
      })));
    }
    if (req.method === 'POST' && chemin === '/api/admin/boutique/offres') {
      const { titre } = await lireJson(req);
      if (typeof titre !== 'string' || !titre.trim()) throw new ErreurHttp(400, 'Titre requis.');
      const o = await magasin.modifier('offres', [], (liste) => {
        const offre = normaliserOffre({ id: idUnique(titre, liste.map((x) => x.id)), titre, modifieLe: maintenant() });
        liste.push(offre);
        return offre;
      });
      return envoyer(res, 201, o);
    }
    if ((p = m(/^\/api\/admin\/boutique\/offres\/([^/]+)$/))) {
      const id = p[1];
      const actuelle = (await lireOffres()).find((o) => o.id === id);
      if (!actuelle) throw new ErreurHttp(404, 'Offre introuvable.');
      if (req.method === 'GET') return envoyer(res, 200, actuelle);
      if (req.method === 'PUT') {
        const offre = normaliserOffre({ ...(await lireJson(req)), id, modifieLe: maintenant() });
        const erreurs = verifierOffre(offre);
        if (erreurs.length) throw new ErreurHttp(422, erreurs.join(' '), { erreurs });
        const formations = new Set((await ctx.listerFormations()).map((f) => f.id));
        offre.formations = offre.formations.filter((f) => formations.has(f));
        await magasin.modifier('offres', [], (liste) => { liste[liste.findIndex((o) => o.id === id)] = offre; });
        prevenirAttente().catch((e) => console.error('Liste d\'attente :', e));
        return envoyer(res, 200, offre);
      }
      if (req.method === 'DELETE') {
        if ((await lireCommandes()).some((c) => c.offre === id && c.statut !== 'expiree')) {
          throw new ErreurHttp(409, 'Des inscriptions existent pour cette offre : dépubliez-la plutôt que de la supprimer.');
        }
        await magasin.modifier('offres', [], (liste) => { liste.splice(liste.findIndex((o) => o.id === id), 1); });
        return envoyer(res, 200, { supprime: id });
      }
    }

    if (req.method === 'GET' && chemin === '/api/admin/boutique/inscriptions') {
      const commandes = (await lireCommandes()).filter((c) => c.statut !== 'expiree' || Date.now() - Date.parse(c.creeLe) < 2 * JOUR);
      const totaux = { encaisse: 0, commission: 0, horsLigne: 0, aVenir: 0 };
      for (const c of commandes) {
        if (c.statut === 'retiree' || c.statut === 'en-attente' || c.statut === 'expiree') continue;
        for (const e of c.echeances) {
          if (e.statut === 'payee') {
            if (c.mode === 'hors-ligne') totaux.horsLigne += e.montant;
            else { totaux.encaisse += e.montant; totaux.commission += commissionSur(e.montant, c.commissionPourcent); }
          } else totaux.aVenir += e.montant;
        }
      }
      return envoyer(res, 200, {
        totaux,
        commandes: commandes.sort((a, b) => b.creeLe.localeCompare(a.creeLe))
          .map(({ cle, stripeClient, stripeMoyen, ...c }) => c),
      });
    }

    if (req.method === 'GET' && chemin === '/api/admin/boutique/attente') {
      const attente = await magasin.lire('attente', []);
      return envoyer(res, 200, attente.sort((a, b) => a.creeLe.localeCompare(b.creeLe)));
    }
    if (req.method === 'DELETE' && (p = m(/^\/api\/admin\/boutique\/attente\/([a-z0-9-]+)$/))) {
      await magasin.modifier('attente', [], (liste) => {
        const i = liste.findIndex((a) => a.id === p[1]);
        if (i === -1) throw new ErreurHttp(404, 'Personne introuvable dans la liste.');
        liste.splice(i, 1);
      });
      return envoyer(res, 200, { retire: true });
    }
    if (req.method === 'GET' && chemin === '/api/admin/boutique/invitations') {
      const invitations = await magasin.lire('invitations', []);
      return envoyer(res, 200, invitations.filter((i) => !i.annuleeLe).sort((a, b) => b.creeLe.localeCompare(a.creeLe))
        .map((i) => ({ ...i, url: `${base(req)}/boutique/#/invitation/${i.jeton}`, expiree: Date.parse(i.expire) < Date.now() })));
    }
    if (req.method === 'POST' && chemin === '/api/admin/boutique/invitations') {
      const corps = await lireJson(req);
      const o = (await lireOffres()).find((x) => x.id === corps.offre);
      if (!o) throw new ErreurHttp(404, 'Offre introuvable.');
      const email = normaliserEmail(corps.email);
      if (!EMAIL_VALIDE.test(email)) throw new ErreurHttp(400, 'Adresse e-mail invalide.');
      const prix = corps.prix === undefined || corps.prix === '' ? o.prix : Math.round(Number(corps.prix));
      if (!Number.isFinite(prix) || prix < 0) throw new ErreurHttp(400, 'Prix invalide.');
      const verif = verifierOffre({ ...o, prix, echeances: Number(corps.echeances) === 3 ? 3 : 1 });
      if (verif.length) throw new ErreurHttp(422, verif.join(' '));
      const invitation = {
        jeton: jeton(18), offre: o.id, offreTitre: o.titre, email,
        nom: typeof corps.nom === 'string' ? corps.nom.trim().slice(0, 120) : '',
        prix, echeances: Number(corps.echeances) === 3 ? 3 : 1,
        creeLe: maintenant(), expire: new Date(Date.now() + DUREE_INVITATION).toISOString(),
      };
      await magasin.modifier('invitations', [], (liste) => { liste.push(invitation); });
      return envoyer(res, 201, { ...invitation, url: `${base(req)}/boutique/#/invitation/${invitation.jeton}` });
    }
    if (req.method === 'DELETE' && (p = m(/^\/api\/admin\/boutique\/invitations\/([A-Za-z0-9_-]+)$/))) {
      await magasin.modifier('invitations', [], (liste) => {
        const inv = liste.find((x) => x.jeton === p[1]);
        if (!inv) throw new ErreurHttp(404, 'Lien introuvable.');
        inv.annuleeLe = maintenant();
      });
      return envoyer(res, 200, { annule: true });
    }

    // Inscription réglée hors ligne (espèces, virement) : ouvre les mêmes accès.
    if (req.method === 'POST' && chemin === '/api/admin/boutique/acces') {
      const corps = await lireJson(req);
      const o = (await lireOffres()).find((x) => x.id === corps.offre);
      if (!o) throw new ErreurHttp(404, 'Offre introuvable.');
      const email = normaliserEmail(corps.email);
      const nom = typeof corps.nom === 'string' ? corps.nom.trim().slice(0, 120) : '';
      if (!EMAIL_VALIDE.test(email)) throw new ErreurHttp(400, 'Adresse e-mail invalide.');
      if (!nom) throw new ErreurHttp(400, 'Nom requis.');
      const montant = Math.max(0, Math.round(Number(corps.montant) || 0));
      const id = `c-${randomBytes(6).toString('hex')}`;
      await magasin.modifier('commandes', [], (liste) => {
        liste.push({
          id, offre: o.id, offreTitre: o.titre, offreDate: o.date, offreLieu: o.lieu, formations: o.formations,
          invitation: '', email, nom, telephone: '', stagiaire: '', total: montant, mode: 'hors-ligne',
          commissionPourcent: config.commission, note: typeof corps.note === 'string' ? corps.note.slice(0, 300) : '',
          echeances: [{ numero: 1, montant, statut: 'a-venir', du: maintenant() }],
          statut: 'en-attente', cle: hacher(jeton()), creeLe: maintenant(), stripeSession: '',
        });
      });
      return envoyer(res, 201, await validerPaiement(req, id, { echeance: 1 }));
    }

    if (req.method === 'POST' && (p = m(/^\/api\/admin\/boutique\/commandes\/([a-z0-9-]+)\/(retirer|retablir|relancer|lien)$/))) {
      const [, id, action] = p;
      const c = (await lireCommandes()).find((x) => x.id === id);
      if (!c) throw new ErreurHttp(404, 'Inscription introuvable.');
      if (action === 'lien') {
        if (!c.stagiaire) throw new ErreurHttp(409, 'Pas encore de compte : l\'inscription n\'est pas payée.');
        return envoyer(res, 200, { url: await lienConnexion(req, c.stagiaire, DUREE_LIEN_CONFIRMATION) });
      }
      const maj = await modifierCommande(id, (cmd) => {
        if (action === 'retirer' && ACTIVES.has(cmd.statut)) cmd.statut = 'retiree';
        if (action === 'retablir' && cmd.statut === 'retiree') {
          cmd.statut = cmd.echeances.every((x) => x.statut === 'payee') ? 'payee' : 'en-cours';
        }
        if (action === 'relancer') {
          const e = cmd.echeances.find((x) => x.statut === 'echec');
          if (!e) throw new ErreurHttp(409, 'Aucun versement en échec.');
          e.statut = 'a-venir';
          e.du = maintenant();
        }
      });
      if (action === 'relancer') preleverEcheances().catch((e) => console.error(e));
      if (action === 'retirer') prevenirAttente().catch((e) => console.error('Liste d\'attente :', e));
      const { cle, stripeClient, stripeMoyen, ...publique } = maj;
      return envoyer(res, 200, publique);
    }

    throw new ErreurHttp(404, 'Route inconnue.');
  }

  // ---------- Routes publiques ----------

  async function router(req, res, chemin, url) {
    const m = (motif) => chemin.match(motif);
    let p;

    if (chemin.startsWith('/api/admin/boutique/')) {
      ctx.exigerAdmin(req);
      await routerAdmin(req, res, chemin, url);
      return true;
    }
    if (req.method === 'POST' && chemin === '/api/stripe/webhook') { await webhook(req, res); return true; }

    // Liste des offres : lisible par le site de l'organisatrice (CORS limité à ses adresses).
    if (req.method === 'GET' && chemin === '/api/boutique/offres') {
      const [offres, commandes] = await Promise.all([lireOffres(), lireCommandes()]);
      const origine = req.headers.origin;
      const cors = origine && config.origines.includes(origine) ? { 'Access-Control-Allow-Origin': origine, Vary: 'Origin' } : { Vary: 'Origin' };
      envoyer(res, 200, offres.filter((o) => o.publie && !passee(o)).sort(ordreOffres).map((o) => offrePublique(o, commandes, req)), cors);
      return true;
    }
    if (req.method === 'GET' && (p = m(/^\/api\/boutique\/offres\/([a-z0-9-]+)$/))) {
      const [offres, commandes] = await Promise.all([lireOffres(), lireCommandes()]);
      const o = offres.find((x) => x.id === p[1] && x.publie);
      if (!o) throw new ErreurHttp(404, 'Cette offre n\'existe pas ou n\'est plus proposée.');
      envoyer(res, 200, offrePublique(o, commandes, req));
      return true;
    }
    // Fichier d'agenda : offre publiée, ou offre à laquelle le visiteur connecté est inscrit.
    if (req.method === 'GET' && (p = m(/^\/api\/boutique\/offres\/([a-z0-9-]+)\/agenda\.ics$/))) {
      const o = (await lireOffres()).find((x) => x.id === p[1]);
      let permis = o?.publie;
      if (o && !permis) {
        const moi = await stagiaireConnecte(req);
        permis = Boolean(moi) && (await lireCommandes()).some((c) => c.offre === o.id && c.stagiaire === moi.id && ACTIVES.has(c.statut));
      }
      if (!o || !permis || !o.date) throw new ErreurHttp(404, 'Rendez-vous introuvable.');
      const corps = fichierIcs({
        uid: `${o.id}@${new URL(base(req)).hostname}`, titre: `${o.titre} — ${config.nom}`, date: o.date,
        duree: o.duree, lieu: o.lieu, description: o.resume, url: `${base(req)}/boutique/#/offre/${o.id}`,
      });
      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${o.id}.ics"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(corps);
      return true;
    }
    if (req.method === 'POST' && (p = m(/^\/api\/boutique\/offres\/([a-z0-9-]+)\/attente$/))) {
      exigerOrigine(req);
      limiter(req, 'attente', 5, 15 * 60 * 1000);
      const o = (await lireOffres()).find((x) => x.id === p[1] && x.publie);
      if (!o || passee(o)) throw new ErreurHttp(404, 'Cette offre n\'existe pas ou n\'est plus proposée.');
      if (placesRestantes(o, await lireCommandes()) !== 0) throw new ErreurHttp(409, 'Il reste des places : vous pouvez réserver directement.');
      const corps = await lireJson(req);
      const email = normaliserEmail(corps.email);
      const nom = typeof corps.nom === 'string' ? corps.nom.trim().slice(0, 120) : '';
      if (!nom) throw new ErreurHttp(400, 'Indiquez votre nom.');
      if (!EMAIL_VALIDE.test(email)) throw new ErreurHttp(400, 'Adresse e-mail invalide.');
      const rang = await magasin.modifier('attente', [], (liste) => {
        const deja = liste.find((a) => a.offre === o.id && a.email === email && !a.prevenuLe);
        if (!deja) liste.push({ id: `a-${randomBytes(6).toString('hex')}`, offre: o.id, offreTitre: o.titre, email, nom, creeLe: maintenant() });
        return liste.filter((a) => a.offre === o.id && !a.prevenuLe).findIndex((a) => a.email === email) + 1;
      });
      envoyer(res, 201, { inscrit: true, rang });
      return true;
    }
    if (req.method === 'GET' && (p = m(/^\/api\/boutique\/invitations\/([A-Za-z0-9_-]+)$/))) {
      const inv = (await magasin.lire('invitations', [])).find((x) => x.jeton === p[1]);
      const o = inv && (await lireOffres()).find((x) => x.id === inv.offre);
      if (!inv || !o || inv.annuleeLe) throw new ErreurHttp(404, 'Ce lien personnel n\'existe pas.');
      envoyer(res, 200, {
        offre: offrePublique(o, await lireCommandes(), req), nom: inv.nom, email: inv.email, prix: inv.prix,
        echeances: inv.echeances, montants: inv.prix ? echeancier(inv.prix, 3) : [0],
        utilisee: Boolean(inv.utiliseeLe), expiree: Date.parse(inv.expire) < Date.now(),
      });
      return true;
    }
    if (req.method === 'POST' && chemin === '/api/boutique/commandes') {
      exigerOrigine(req);
      envoyer(res, 201, await creerCommande(req, await lireJson(req)));
      return true;
    }
    if (req.method === 'GET' && (p = m(/^\/api\/boutique\/commandes\/([a-z0-9-]+)$/))) {
      let c = await commandeAvecCle(p[1], url.searchParams.get('cle'));
      await synchroniser(req, c);
      c = await commandeAvecCle(p[1], url.searchParams.get('cle'));
      const moi = await stagiaireConnecte(req);
      envoyer(res, 200, {
        statut: c.statut, offre: c.offreTitre, offreId: c.offre, date: dateLisible(c.offreDate), lieu: c.offreLieu,
        agenda: c.offreDate && ACTIVES.has(c.statut) ? `${base(req)}/api/boutique/offres/${c.offre}/agenda.ics` : '',
        total: c.total, versements: versementsPublics(c), email: c.email, nom: c.nom,
        formations: ACTIVES.has(c.statut) ? await formationsTitrees(c.formations || []) : [],
        connecte: Boolean(moi && moi.id === c.stagiaire), compteCree: Boolean(c.compteCree),
        simulation: c.mode === 'simulation' && c.statut === 'en-attente' && config.simulation,
      });
      return true;
    }
    // Connexion directe au retour du paiement, seulement pour un compte créé par cette inscription :
    // payer avec l'adresse de quelqu'un d'autre n'ouvre jamais son espace.
    if (req.method === 'POST' && (p = m(/^\/api\/boutique\/commandes\/([a-z0-9-]+)\/connexion$/))) {
      exigerOrigine(req);
      const { cle } = await lireJson(req);
      const c = await commandeAvecCle(p[1], cle);
      if (!ACTIVES.has(c.statut) || !c.stagiaire) throw new ErreurHttp(409, 'Paiement pas encore confirmé.');
      if (!c.compteCree || c.connexionUtilisee) {
        throw new ErreurHttp(403, 'Un espace existe déjà pour cette adresse : ouvrez le lien reçu par e-mail.', { parLien: true });
      }
      await modifierCommande(c.id, (cmd) => { cmd.connexionUtilisee = maintenant(); });
      envoyer(res, 200, { connecte: true }, { 'Set-Cookie': await ouvrirSession(req, c.stagiaire) });
      return true;
    }
    if (req.method === 'POST' && chemin === '/api/boutique/simulation') {
      exigerOrigine(req);
      if (!config.simulation) throw new ErreurHttp(404, 'Route inconnue.');
      const { commande, cle } = await lireJson(req);
      const c = await commandeAvecCle(commande, cle);
      if (c.mode !== 'simulation') throw new ErreurHttp(409, 'Paiement réel : rien à simuler.');
      await validerPaiement(req, c.id, { echeance: 1 });
      envoyer(res, 200, { paye: true });
      return true;
    }

    // Espace du stagiaire
    if (req.method === 'GET' && chemin === '/api/compte') {
      const moi = await stagiaireConnecte(req);
      if (!moi) { envoyer(res, 200, { connecte: false, courriel: courriel.actif }); return true; }
      const commandes = (await lireCommandes()).filter((c) => c.stagiaire === moi.id && c.statut !== 'expiree' && c.statut !== 'en-attente');
      envoyer(res, 200, {
        connecte: true, nom: moi.nom, email: moi.email,
        inscriptions: commandes.sort((a, b) => (a.offreDate || '9999').localeCompare(b.offreDate || '9999')).map((c) => ({
          offre: c.offreTitre, offreId: c.offre, date: dateLisible(c.offreDate), lieu: c.offreLieu, statut: c.statut,
          total: c.total, versements: versementsPublics(c),
          agenda: c.offreDate && ACTIVES.has(c.statut) ? `${base(req)}/api/boutique/offres/${c.offre}/agenda.ics` : '',
        })),
        formations: await formationsTitrees([...(await formationsDe(moi))]),
      });
      return true;
    }
    if (req.method === 'POST' && chemin === '/api/compte/lien') {
      exigerOrigine(req);
      limiter(req, 'lien', 5, 15 * 60 * 1000);
      const email = normaliserEmail((await lireJson(req)).email);
      if (!EMAIL_VALIDE.test(email)) throw new ErreurHttp(400, 'Adresse e-mail invalide.');
      const s = (await lireStagiaires()).find((x) => x.email === email);
      // Même réponse que l'adresse soit connue ou non : on ne révèle pas qui est inscrit.
      if (s) {
        const lien = await lienConnexion(req, s.id, DUREE_LIEN);
        const { texte, html } = message([`Bonjour ${s.nom || ''},`.replace(' ,', ','), 'Voici votre lien pour ouvrir votre espace. Il est valable 20 minutes et ne sert qu\'une fois.'], lien, 'Ouvrir mon espace');
        courriel.envoyer({ a: email, sujet: `Votre lien de connexion — ${config.nom}`, texte, html });
      }
      envoyer(res, 200, { envoye: true, courriel: courriel.actif });
      return true;
    }
    if (req.method === 'POST' && chemin === '/api/compte/connexion') {
      exigerOrigine(req);
      limiter(req, 'connexion', 20, 15 * 60 * 1000);
      const t = String((await lireJson(req)).jeton || '');
      const lien = await magasin.modifier('liens', {}, (liens) => {
        const l = liens[hacher(t)];
        delete liens[hacher(t)];
        return l;
      });
      if (!lien || Date.parse(lien.expire) < Date.now()) throw new ErreurHttp(410, 'Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.');
      envoyer(res, 200, { connecte: true }, { 'Set-Cookie': await ouvrirSession(req, lien.stagiaire) });
      return true;
    }
    if (req.method === 'POST' && chemin === '/api/compte/deconnexion') {
      exigerOrigine(req);
      const t = lireCookie(req, 'stagiaire_session');
      if (t) await magasin.modifier('sessions', {}, (sessions) => { delete sessions[hacher(t)]; });
      envoyer(res, 200, { connecte: false }, { 'Set-Cookie': cookieStagiaire(req, '', 0) });
      return true;
    }
    return false;
  }

  function demarrer() {
    const tic = () => {
      preleverEcheances().catch((e) => console.error('Prélèvements :', e));
      envoyerRappels().catch((e) => console.error('Rappels :', e));
      prevenirAttente().catch((e) => console.error('Liste d\'attente :', e));
    };
    setTimeout(tic, 30 * 1000).unref();
    setInterval(tic, 3600 * 1000).unref();
    const etat = { aucun: 'paiement en ligne fermé (offres gratuites seulement)', simulation: 'paiements SIMULÉS', test: 'Stripe en mode test', reel: 'Stripe en mode réel' }[modePaiement];
    console.log(`Boutique ${config.nom} : ${etat}${stripe && !config.compte ? ' — compte de l\'organisatrice non relié (STRIPE_COMPTE)' : ''}.`);
  }

  return {
    router,
    demarrer,
    // Formations ouvertes au visiteur grâce à ses inscriptions.
    async formationsAccessibles(req) { return formationsDe(await stagiaireConnecte(req)); },
  };
}
