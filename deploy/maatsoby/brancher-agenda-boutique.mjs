#!/usr/bin/env node
// Branche l'agenda du site de Maât Soby sur la boutique de la plateforme de formation.
// Les dates publiées dans la boutique font foi ; les dates de site.json servent de complément
// (voie, photos, jalons, ancienne adresse) et de secours si la boutique ne répond pas.
//
// Usage : node brancher-agenda-boutique.mjs /DATA/AppData/maatsoby
// Modifie server.js et public/admin.html sur place (sauvegardez-les avant). Sans effet si déjà appliqué.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dossier = process.argv[2];
if (!dossier) { console.error('Usage : node brancher-agenda-boutique.mjs <dossier du site>'); process.exit(1); }
const MARQUE = '// ---------- Agenda : lu dans la boutique';

function remplacer(texte, avant, apres, fichier) {
  const n = texte.split(avant).length - 1;
  if (n !== 1) throw new Error(`${fichier} : passage attendu une fois, trouvé ${n} fois :\n${avant}`);
  return texte.replace(avant, () => apres);
}

// ---------- server.js ----------
const cheminServeur = join(dossier, 'server.js');
let s = readFileSync(cheminServeur, 'utf8');
if (s.includes(MARQUE)) {
  // Version précédente : seuls les « jours » étaient comptés ; on ajoute les semaines.
  const ANCIENNE_DUREE = "const jours = Math.max(1, Number((String(o.duree || '').match(/(\\d+)\\s*jours?/i) || [])[1]) || 1);";
  if (s.includes(ANCIENNE_DUREE)) {
    s = s.replace(ANCIENNE_DUREE, () => `const jours = Math.max(1, [...String(o.duree || '').toLowerCase().matchAll(/(\\d+)\\s*(semaines?|jours?)/g)]
    .reduce((t, [, n, u]) => t + Number(n) * (u.startsWith('semaine') ? 7 : 1), 0));`);
    writeFileSync(cheminServeur, s);
    console.log('server.js : durée en semaines prise en compte.');
  } else {
    console.log('server.js : déjà branché, rien à faire.');
  }
} else {
  s = remplacer(s, `let sessions = lire('sessions.json', {});\n`, `let sessions = lire('sessions.json', {});

${MARQUE} de la plateforme de formation ----------
// Les dates publiées dans la boutique font foi. Celles de site.json complètent (voie, photos, jalons)
// et servent de secours si la boutique ne répond pas ; la dernière liste reçue est gardée sur disque.
const BOUTIQUE_OFFRES = process.env.BOUTIQUE_OFFRES || 'https://akasha-formation.nubitech.org/api/boutique/offres';
let offresBoutique = lire('boutique-cache.json', null);
let derniereLecture = 0;
async function rafraichirBoutique() {
  if (Date.now() - derniereLecture < 60e3) return;
  derniereLecture = Date.now();
  try {
    const r = await fetch(BOUTIQUE_OFFRES, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('réponse ' + r.status);
    const liste = await r.json();
    if (!Array.isArray(liste)) throw new Error('format inattendu');
    offresBoutique = liste;
    ecrire('boutique-cache.json', liste);
  } catch (e) { console.warn('Boutique injoignable, agenda de secours :', e.message); }
}
// Si une liste est déjà connue, on répond tout de suite et on la rafraîchit en arrière-plan.
async function boutiqueAJour() {
  const lecture = rafraichirBoutique();
  if (!Array.isArray(offresBoutique)) await lecture;
}
function versEvenement(o) {
  const comparable = v => enSlug(v, 200);
  const lie = site.evenements.find(e => e.stage === o.id || e.slug === o.id || comparable(e.titre) === comparable(o.titre));
  const debut = String(o.date).slice(0, 10);
  const jours = Math.max(1, [...String(o.duree || '').toLowerCase().matchAll(/(\\d+)\\s*(semaines?|jours?)/g)]
    .reduce((t, [, n, u]) => t + Number(n) * (u.startsWith('semaine') ? 7 : 1), 0));
  const fin = new Date(Date.parse(debut + 'T12:00:00Z') + (jours - 1) * 864e5).toISOString().slice(0, 10);
  const heure = String(o.date).includes('T') ? String(o.date).slice(11, 16).replace(':', ' h ') : (lie?.heure || '');
  const tarif = o.paiement === 'invitation' ? 'Sur rendez-vous'
    : o.prix ? \`\${o.prixLisible}\${o.echeances === 3 ? ' · réglable en 3 fois' : ''}\` : 'Gratuit';
  return {
    id: lie?.id || 'boutique-' + o.id, titre: o.titre, court: lie?.court || '',
    voie: lie?.voie || (o.type === 'cercle' ? 'cercle' : 'ame'),
    debut, fin, heure, lieu: o.lieu || '', texte: o.resume || '', details: o.description || '', tarif,
    lien: o.url || '', stage: lie?.stage || '', jalons: lie?.jalons || [], slug: lie?.slug || o.id, ancien: lie?.ancien || ''
  };
}
function evenementsAffiches() {
  if (!Array.isArray(offresBoutique)) return site.evenements;
  return offresBoutique.filter(o => /^\\d{4}-\\d{2}-\\d{2}/.test(o.date || '')).map(versEvenement);
}
`, 'server.js');

  s = remplacer(s, `const publicData = () => ({
  evenements: [...site.evenements].sort((a, b) => a.debut.localeCompare(b.debut)),
  stages: site.stages.filter(s => s.visible),
  photos: site.photos.filter(p => p.evenement ? site.evenements.some(e => e.id === p.evenement) : site.stages.some(s => s.id === p.stage && s.visible))
});`, `const publicData = () => {
  const evenements = evenementsAffiches();
  return {
    evenements: [...evenements].sort((a, b) => a.debut.localeCompare(b.debut)),
    stages: site.stages.filter(s => s.visible),
    photos: site.photos.filter(p => p.evenement ? evenements.some(e => e.id === p.evenement) : site.stages.some(s => s.id === p.stage && s.visible))
  };
};`, 'server.js');

  s = remplacer(s, `  if (p === '/api/site' && m === 'GET') return json(res, 200, publicData());`,
    `  if (p === '/api/site' && m === 'GET') { await boutiqueAJour(); return json(res, 200, publicData()); }`, 'server.js');

  s = remplacer(s, `    if (!site.evenements.some(e => e.slug === agenda[1])) return rediriger(res, '/#agenda');`,
    `    await boutiqueAJour();
    if (!evenementsAffiches().some(e => e.slug === agenda[1])) return rediriger(res, '/#agenda');`, 'server.js');

  s = remplacer(s, `    const e = site.evenements.find(x => x.ancien && x.ancien === enSlug(decodeURIComponent(ancienne[1]), 200));`,
    `    await boutiqueAJour();
    const e = evenementsAffiches().find(x => x.ancien && x.ancien === enSlug(decodeURIComponent(ancienne[1]), 200));`, 'server.js');

  writeFileSync(cheminServeur, s);
  console.log('server.js : agenda branché sur la boutique.');
}

// ---------- admin.html : prévenir que l'agenda public vient de la boutique ----------
const cheminAdmin = join(dossier, 'public', 'admin.html');
let a = readFileSync(cheminAdmin, 'utf8');
if (a.includes('data-agenda-boutique')) {
  console.log('admin.html : déjà prévenu, rien à faire.');
} else {
  a = remplacer(a, `        <div id="evt-liste" style="margin-top:12px"></div>`, `        <p class="hint" data-agenda-boutique style="margin-top:12px">Les dates visibles sur le site viennent de la boutique (offres publiées avec une date) : c'est là qu'on ajoute ou change une date, un prix ou un lieu. Ici, on garde les photos, la voie et les jalons de chaque date ; cette liste sert aussi de secours si la boutique ne répond pas.</p>
        <div id="evt-liste" style="margin-top:12px"></div>`, 'admin.html');
  writeFileSync(cheminAdmin, a);
  console.log("admin.html : note ajoutée dans l'onglet Agenda.");
}
