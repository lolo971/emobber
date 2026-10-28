// Envoi des e-mails de la boutique (liens de connexion, confirmations).
// Le serveur ne parle pas SMTP lui-même : il confie le message à un webhook (n8n par exemple),
// qui l'envoie avec le compte e-mail configuré dans n8n.

export function creerCourriel({ webhook, journaliserLiens = false }) {
  return {
    actif: Boolean(webhook),
    async envoyer({ a, sujet, texte, html }) {
      if (!webhook) {
        console.warn(`E-mail non envoyé (BOUTIQUE_COURRIEL_WEBHOOK absent) à ${a} : ${sujet}`);
        if (journaliserLiens) console.warn(texte);
        return false;
      }
      try {
        const reponse = await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ a, sujet, texte, html }),
          signal: AbortSignal.timeout(15000),
        });
        if (!reponse.ok) throw new Error(`réponse ${reponse.status}`);
        return true;
      } catch (e) {
        console.error(`E-mail non envoyé à ${a} (${sujet}) :`, e.message);
        return false;
      }
    },
  };
}
