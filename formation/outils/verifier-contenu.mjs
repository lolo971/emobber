#!/usr/bin/env node
// Vérifie la cohérence du contenu de formation avant publication.
// Usage : node formation/outils/verifier-contenu.mjs   (code de sortie 1 si erreur)

import { readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const contenu = join(dirname(fileURLToPath(import.meta.url)), '..', 'contenu');
const erreurs = [];
const avertissements = [];

async function lireJson(chemin) {
  try {
    return JSON.parse(await readFile(chemin, 'utf8'));
  } catch (e) {
    erreurs.push(`${chemin} : illisible (${e.message})`);
    return null;
  }
}

async function existe(chemin) {
  try { await access(chemin); return true; } catch { return false; }
}

function verifierSeuil(valeur, ou) {
  if (valeur !== undefined && !(Number.isFinite(valeur) && valeur >= 0 && valeur <= 100)) {
    erreurs.push(`${ou} : "seuil" doit être un nombre entre 0 et 100`);
  }
}

const parcours = await lireJson(join(contenu, 'parcours.json'));
if (parcours) {
  for (const champ of ['id', 'titre']) {
    if (typeof parcours[champ] !== 'string' || !parcours[champ].trim()) erreurs.push(`parcours.json : "${champ}" manquant`);
  }
  verifierSeuil(parcours.seuilReussite, 'parcours.json (seuilReussite)');
  if (!Array.isArray(parcours.niveaux) || parcours.niveaux.length === 0) {
    erreurs.push('parcours.json : "niveaux" doit être une liste non vide');
  }

  const ids = new Set();
  for (const [i, niveau] of (parcours.niveaux || []).entries()) {
    const ou = `parcours.json niveau ${i + 1}`;
    for (const champ of ['id', 'titre', 'resume', 'dossier']) {
      if (typeof niveau[champ] !== 'string' || !niveau[champ].trim()) erreurs.push(`${ou} : "${champ}" manquant`);
    }
    if (ids.has(niveau.id)) erreurs.push(`${ou} : id "${niveau.id}" en double`);
    ids.add(niveau.id);
    if (typeof niveau.dossier !== 'string') continue;

    const dossier = join(contenu, niveau.dossier);
    if (!(await existe(join(dossier, 'lecon.html')))) erreurs.push(`${niveau.dossier}/lecon.html : manquant`);
    const quiz = await lireJson(join(dossier, 'niveau.json'));
    if (!quiz) continue;

    const ouQuiz = `${niveau.dossier}/niveau.json`;
    verifierSeuil(quiz.seuil, ouQuiz);
    if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
      erreurs.push(`${ouQuiz} : "questions" doit être une liste non vide`);
      continue;
    }
    if (quiz.questions.length < 3) avertissements.push(`${ouQuiz} : moins de 3 questions`);

    const idsQuestions = new Set();
    for (const [q, question] of quiz.questions.entries()) {
      const ouQ = `${ouQuiz} question ${q + 1}`;
      if (question.id) {
        if (idsQuestions.has(question.id)) erreurs.push(`${ouQ} : id "${question.id}" en double`);
        idsQuestions.add(question.id);
      }
      if (typeof question.enonce !== 'string' || !question.enonce.trim()) erreurs.push(`${ouQ} : "enonce" manquant`);
      if (!Array.isArray(question.choix) || question.choix.length < 2) {
        erreurs.push(`${ouQ} : au moins 2 choix requis`);
        continue;
      }
      if (new Set(question.choix).size !== question.choix.length) erreurs.push(`${ouQ} : choix en double`);
      const bonnes = question.bonnes;
      if (!Array.isArray(bonnes) || bonnes.length === 0) {
        erreurs.push(`${ouQ} : "bonnes" doit lister au moins un numéro de choix`);
      } else if (bonnes.some((b) => !Number.isInteger(b) || b < 0 || b >= question.choix.length)) {
        erreurs.push(`${ouQ} : "bonnes" contient un numéro hors de 0…${question.choix.length - 1}`);
      } else if (new Set(bonnes).size !== bonnes.length) {
        erreurs.push(`${ouQ} : "bonnes" contient un doublon`);
      }
      if (!question.explication) avertissements.push(`${ouQ} : pas d'explication`);
    }
  }
}

for (const a of avertissements) console.warn(`⚠ ${a}`);
for (const e of erreurs) console.error(`✗ ${e}`);
if (erreurs.length) {
  console.error(`\n${erreurs.length} erreur(s) : corriger avant de publier.`);
  process.exit(1);
}
console.log(`✓ Contenu valide : ${parcours.niveaux.length} niveau(x).`);
