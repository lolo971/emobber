#!/usr/bin/env node
// Vérifie les formations d'un dossier de données (mêmes règles que la publication).
// Usage : node outils/verifier-contenu.mjs [dossier]   (défaut : donnees-initiales)
// Code de sortie 1 si une formation publiée a des erreurs.

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliserFormation, verifierFormation } from '../public/commun/valider.js';

const ici = dirname(fileURLToPath(import.meta.url));
const dossier = resolve(process.argv[2] || join(ici, '..', 'donnees-initiales'), 'formations');
let bloquant = 0;

for (const fichier of (await readdir(dossier)).filter((f) => f.endsWith('.json')).sort()) {
  let brut;
  try {
    brut = JSON.parse(await readFile(join(dossier, fichier), 'utf8'));
  } catch (e) {
    console.error(`✗ ${fichier} : JSON illisible (${e.message})`);
    bloquant += 1;
    continue;
  }
  const f = normaliserFormation(brut);
  const { erreurs, avertissements } = verifierFormation(f);
  if (`${f.id}.json` !== fichier) erreurs.push(`le nom du fichier doit être ${f.id}.json`);
  const statut = f.publie ? 'publiée' : 'brouillon';
  console.log(`${erreurs.length ? '✗' : '✓'} ${fichier} (${statut}, ${f.niveaux.length} niveaux)`);
  for (const e of erreurs) console.log(`    ✗ ${e}`);
  for (const a of avertissements) console.log(`    ⚠ ${a}`);
  if (f.publie && erreurs.length) bloquant += 1;
}

process.exit(bloquant ? 1 : 0);
