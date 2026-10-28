// Appels à l'API Stripe sans dépendance (fetch + formulaire encodé) et vérification des webhooks.
// Les paiements sont des « charges directes » sur le compte connecté de l'organisatrice
// (en-tête Stripe-Account) ; la plateforme prélève sa commission par application_fee_amount.

import { createHmac, timingSafeEqual } from 'node:crypto';

const VERSION = '2024-06-20';

// { a: { b: [1, 2] } } → a[b][0]=1&a[b][1]=2
function encoder(objet, prefixe = '', sortie = new URLSearchParams()) {
  for (const [cle, valeur] of Object.entries(objet)) {
    if (valeur === undefined || valeur === null) continue;
    const nom = prefixe ? `${prefixe}[${cle}]` : cle;
    if (typeof valeur === 'object') encoder(valeur, nom, sortie);
    else sortie.append(nom, String(valeur));
  }
  return sortie;
}

export function creerStripe({ cle, compte, base = 'https://api.stripe.com/v1/' }) {
  async function appel(methode, chemin, parametres = {}, { idempotence, surCompte = true } = {}) {
    const corps = encoder(parametres);
    const url = methode === 'GET' && [...corps].length ? `${base}${chemin}?${corps}` : `${base}${chemin}`;
    const reponse = await fetch(url, {
      method: methode,
      headers: {
        Authorization: `Bearer ${cle}`,
        'Stripe-Version': VERSION,
        ...(methode !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(surCompte && compte ? { 'Stripe-Account': compte } : {}),
        ...(idempotence ? { 'Idempotency-Key': idempotence } : {}),
      },
      body: methode === 'GET' ? undefined : corps,
      signal: AbortSignal.timeout(20000),
    });
    const donnees = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      const e = new Error(donnees.error?.message || `Stripe a répondu ${reponse.status}`);
      e.stripe = donnees.error || {};
      e.statut = reponse.status;
      throw e;
    }
    return donnees;
  }
  return { appel, modeTest: /^(sk|rk)_test_/.test(cle) };
}

// En-tête « Stripe-Signature: t=…,v1=… » : HMAC-SHA256 de « t.corps » avec le secret du webhook.
export function verifierSignature(corpsBrut, entete, secret, tolerance = 300, maintenant = Date.now()) {
  if (!entete || !secret) return false;
  const morceaux = String(entete).split(',').map((m) => m.split('='));
  const t = morceaux.find(([k]) => k === 't')?.[1];
  const signatures = morceaux.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !signatures.length) return false;
  if (Math.abs(maintenant / 1000 - Number(t)) > tolerance) return false;
  const attendue = createHmac('sha256', secret).update(`${t}.`).update(corpsBrut).digest();
  return signatures.some((s) => {
    const recue = Buffer.from(s, 'hex');
    return recue.length === attendue.length && timingSafeEqual(recue, attendue);
  });
}
