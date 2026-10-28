// Petits fichiers JSON de la boutique (offres, commandes, comptes…), gardés en mémoire
// et réécrits de façon atomique. Les modifications passent une par une : pas de course.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function creerMagasin(dossier) {
  const cache = new Map();
  let file = Promise.resolve();

  async function charger(nom, defaut) {
    if (!cache.has(nom)) {
      try {
        cache.set(nom, JSON.parse(await readFile(join(dossier, `${nom}.json`), 'utf8')));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        cache.set(nom, structuredClone(defaut));
      }
    }
    return cache.get(nom);
  }

  async function ecrire(nom, valeur) {
    await mkdir(dossier, { recursive: true });
    const chemin = join(dossier, `${nom}.json`);
    const temporaire = `${chemin}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporaire, `${JSON.stringify(valeur, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaire, chemin);
  }

  return {
    // Lecture : une copie, pour que l'appelant ne modifie rien par mégarde.
    async lire(nom, defaut) {
      await file;
      return structuredClone(await charger(nom, defaut));
    },
    // Modification : `changer` reçoit les données et peut les muter ; son résultat est renvoyé.
    modifier(nom, defaut, changer) {
      const tache = file.then(async () => {
        const copie = structuredClone(await charger(nom, defaut));
        const resultat = await changer(copie);
        await ecrire(nom, copie);
        cache.set(nom, copie);
        return resultat;
      });
      file = tache.catch(() => {});
      return tache;
    },
  };
}
