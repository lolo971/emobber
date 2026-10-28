// Forme et règles d'une offre (cercle, rituel, stage…). Partagé par le serveur et les pages.

import { ID_VALIDE } from './valider.js';

export const TYPES_OFFRE = {
  cercle: 'Cercle', rituel: 'Rituel', stage: 'Stage', reunion: 'Réunion',
  accompagnement: 'Accompagnement', autre: 'Autre',
};
export const PAIEMENTS = {
  direct: 'Réservation directe',
  invitation: 'Sur invitation (lien personnel après un échange)',
};
// Stripe refuse les paiements de moins de 0,50 €.
export const MONTANT_MINIMUM = 50;
const MEDIA = /^medias\/[a-z0-9-]+\.(png|jpe?g|webp|gif)$/;
const DATE_LOCALE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const CONTACT = /^(https:\/\/|mailto:|tel:)\S+$/;

const texte = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const entier = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

export function normaliserOffre(o) {
  return {
    id: texte(o?.id, 64),
    titre: texte(o?.titre, 200),
    type: Object.hasOwn(TYPES_OFFRE, o?.type) ? o.type : 'autre',
    resume: texte(o?.resume, 300),
    description: texte(o?.description, 5000),
    image: typeof o?.image === 'string' && MEDIA.test(o.image) ? o.image : '',
    date: typeof o?.date === 'string' && DATE_LOCALE.test(o.date) ? o.date : '',
    duree: texte(o?.duree, 100),
    lieu: texte(o?.lieu, 200),
    prix: entier(o?.prix, 0, 10_000_000),
    places: entier(o?.places, 0, 10_000),
    paiement: Object.hasOwn(PAIEMENTS, o?.paiement) ? o.paiement : 'direct',
    echeances: Number(o?.echeances) === 3 ? 3 : 1,
    formations: [...new Set((Array.isArray(o?.formations) ? o.formations : [])
      .filter((id) => typeof id === 'string' && ID_VALIDE.test(id)))].slice(0, 50),
    contact: typeof o?.contact === 'string' && CONTACT.test(o.contact.trim()) ? o.contact.trim().slice(0, 500) : '',
    publie: o?.publie === true,
    modifieLe: texte(o?.modifieLe, 40),
  };
}

export function verifierOffre(o) {
  const erreurs = [];
  if (!ID_VALIDE.test(o.id)) erreurs.push('Identifiant d\'offre invalide.');
  if (!o.titre) erreurs.push('L\'offre n\'a pas de titre.');
  if (o.prix > 0 && o.prix < MONTANT_MINIMUM) erreurs.push('Un prix payant doit être d\'au moins 0,50 €.');
  if (o.echeances === 3 && echeancier(o.prix, 3).some((m) => m < MONTANT_MINIMUM)) {
    erreurs.push('Prix trop bas pour un paiement en trois fois.');
  }
  if (o.echeances === 3 && o.prix === 0) erreurs.push('Une offre gratuite ne se paie pas en trois fois.');
  return erreurs;
}

// Montants de chaque versement, en centimes : le premier absorbe l'arrondi.
export function echeancier(total, nombre) {
  const part = Math.floor(total / nombre);
  return Array.from({ length: nombre }, (_, i) => (i === 0 ? total - part * (nombre - 1) : part));
}

export const commissionSur = (montant, pourcent) => Math.round((montant * pourcent) / 100);

export function euros(centimes) {
  const n = (centimes || 0) / 100;
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: Number.isInteger(n) ? 0 : 2 });
}

// « 2026-11-14T18:00 » → « samedi 14 novembre 2026 à 18 h 00 », sans conversion de fuseau.
export function dateLisible(date) {
  if (!date) return '';
  const [j, h] = date.split('T');
  const [a, m, d] = j.split('-').map(Number);
  const jour = new Date(Date.UTC(a, m - 1, d)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return h ? `${jour} à ${h.replace(':', ' h ')}` : jour;
}

export const EMAIL_VALIDE = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
export const normaliserEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase().slice(0, 200) : '');
