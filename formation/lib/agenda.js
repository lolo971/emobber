// Fichier d'agenda (.ics) d'un rendez-vous, lisible par les calendriers des téléphones
// (iPhone, Android, Google Agenda, Outlook). Heure « flottante » : celle du lieu, sans fuseau.

const deux = (n) => String(n).padStart(2, '0');

// « 2026-11-20T18:30 » ou « 2026-11-20 » → composants, sans passer par un fuseau horaire.
function composants(date) {
  const [j, h] = date.split('T');
  const [a, m, d] = j.split('-').map(Number);
  const [hh, mm] = h ? h.split(':').map(Number) : [0, 0];
  return { a, m, d, hh, mm, avecHeure: Boolean(h) };
}

// Durée lue dans le texte libre de l'offre (« 2 h », « 1 h 30 », « 3 jours ») ; 2 h par défaut.
function dureeEnMinutes(duree, avecHeure) {
  const texte = String(duree || '').toLowerCase();
  // « 3 jours », « 7 semaines », « 7 semaines + 21 jours » : les semaines et les jours s'additionnent.
  const jours = [...texte.matchAll(/(\d+)\s*(semaines?|jours?)/g)]
    .reduce((total, [, n, unite]) => total + Number(n) * (unite.startsWith('semaine') ? 7 : 1), 0);
  if (jours) return jours * 24 * 60;
  const heures = texte.match(/(\d+)\s*h(?:eures?)?\s*(\d+)?/);
  const minutes = texte.match(/(\d+)\s*min/);
  if (heures) return Number(heures[1]) * 60 + Number(heures[2] || 0);
  if (minutes) return Number(minutes[1]);
  return avecHeure ? 120 : 24 * 60;
}

const echapper = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lignes de 75 octets maximum, comme l'exige le format.
function plier(ligne) {
  const octets = Buffer.from(ligne, 'utf8');
  if (octets.length <= 75) return ligne;
  const morceaux = [];
  let courant = '';
  for (const c of ligne) {
    if (Buffer.byteLength(courant + c) > (morceaux.length ? 74 : 75)) { morceaux.push(courant); courant = ''; }
    courant += c;
  }
  morceaux.push(courant);
  return morceaux.join('\r\n ');
}

export function fichierIcs({ uid, titre, date, duree, lieu, description, url }) {
  const c = composants(date);
  const debut = new Date(Date.UTC(c.a, c.m - 1, c.d, c.hh, c.mm));
  const fin = new Date(debut.getTime() + dureeEnMinutes(duree, c.avecHeure) * 60000);
  const enDate = (d) => `${d.getUTCFullYear()}${deux(d.getUTCMonth() + 1)}${deux(d.getUTCDate())}`;
  const enHeure = (d) => `${enDate(d)}T${deux(d.getUTCHours())}${deux(d.getUTCMinutes())}00`;
  // Un événement « journée entière » se termine le lendemain du dernier jour (fin exclue).
  const finJour = new Date(Date.UTC(c.a, c.m - 1, c.d) + Math.max(1, Math.round(dureeEnMinutes(duree, false) / 1440)) * 86400000);
  const maintenant = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lignes = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Formation AKASHA//Boutique//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${maintenant}`,
    c.avecHeure ? `DTSTART:${enHeure(debut)}` : `DTSTART;VALUE=DATE:${enDate(debut)}`,
    c.avecHeure ? `DTEND:${enHeure(fin)}` : `DTEND;VALUE=DATE:${enDate(finJour)}`,
    `SUMMARY:${echapper(titre)}`,
    lieu && `LOCATION:${echapper(lieu)}`,
    `DESCRIPTION:${echapper([description, url].filter(Boolean).join('\n\n'))}`,
    url && `URL:${url}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${echapper(titre)}`, 'TRIGGER:-P1D', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return `${lignes.map(plier).join('\r\n')}\r\n`;
}

// Début du rendez-vous en millisecondes (heure du serveur) ; 9 h pour une offre sans heure.
export function debutDe(date) {
  if (!date) return null;
  const t = Date.parse(date.includes('T') ? date : `${date}T09:00`);
  return Number.isFinite(t) ? t : null;
}
