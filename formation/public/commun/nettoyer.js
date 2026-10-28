// Nettoie le HTML d'une leçon : ne garde que la mise en forme autorisée.
// Utilisé à l'enregistrement (back-office) et à l'affichage (apprenant).

const SUPPRIMER = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH',
  'LINK', 'META', 'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'VIDEO', 'AUDIO', 'CANVAS']);
const RENOMMER = { H1: 'H3', H2: 'H3', H5: 'H4', H6: 'H4', B: 'STRONG', I: 'EM' };
const PERMIS = new Set(['P', 'H3', 'H4', 'STRONG', 'EM', 'U', 'UL', 'OL', 'LI', 'A', 'IMG', 'FIGURE',
  'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BR', 'BLOCKQUOTE', 'CODE', 'PRE', 'DIV', 'HR']);
const BLOCS = new Set(['P', 'H3', 'H4', 'UL', 'OL', 'TABLE', 'FIGURE', 'BLOCKQUOTE', 'PRE', 'DIV', 'HR']);
export const CLASSES_ENCADRE = ['encadre', 'exemple', 'attention'];

const LIEN_PERMIS = /^(https?:|mailto:|#)/i;
const IMAGE_PERMISE = /^(medias\/[a-z0-9-]+\.(png|jpe?g|webp|gif)|https:\/\/)/i;

function renommer(el, nom) {
  const neuf = el.ownerDocument.createElement(nom);
  neuf.append(...el.childNodes);
  el.replaceWith(neuf);
  return neuf;
}

function nettoyerAttributs(el) {
  const tag = el.tagName;
  for (const { name, value } of [...el.attributes]) {
    const garder =
      (tag === 'A' && name === 'href' && LIEN_PERMIS.test(value.trim())) ||
      (tag === 'IMG' && name === 'src' && IMAGE_PERMISE.test(value.trim())) ||
      (tag === 'IMG' && name === 'alt') ||
      ((tag === 'TD' || tag === 'TH') && (name === 'colspan' || name === 'rowspan') && /^\d{1,2}$/.test(value)) ||
      (tag === 'DIV' && name === 'class') ||
      (tag === 'HR' && name === 'class');
    if (!garder) el.removeAttribute(name);
  }
  if (tag === 'A' && el.hasAttribute('href') && /^https?:/i.test(el.getAttribute('href'))) {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }
  if (tag === 'IMG' && !el.hasAttribute('src')) el.remove();
}

function nettoyerNoeud(parent) {
  for (const noeud of [...parent.childNodes]) {
    if (noeud.nodeType === Node.COMMENT_NODE) { noeud.remove(); continue; }
    if (noeud.nodeType !== Node.ELEMENT_NODE) continue;
    if (SUPPRIMER.has(noeud.tagName)) { noeud.remove(); continue; }

    nettoyerNoeud(noeud);
    let el = noeud;
    if (RENOMMER[el.tagName]) el = renommer(el, RENOMMER[el.tagName]);

    if (el.tagName === 'DIV') {
      const classe = CLASSES_ENCADRE.find((c) => el.classList.contains(c));
      if (classe) {
        el.className = classe;
      } else if ([...el.children].some((c) => BLOCS.has(c.tagName))) {
        el.replaceWith(...el.childNodes);
        continue;
      } else {
        el = renommer(el, 'P');
      }
    }
    if (el.tagName === 'HR') el.className = 'etape';
    if (!PERMIS.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
    nettoyerAttributs(el);
  }
}

export function nettoyerHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html ?? ''}</body>`, 'text/html');
  nettoyerNoeud(doc.body);
  return doc.body.innerHTML.trim();
}

// Découpe une leçon en étapes (une carte par écran) sur les séparateurs <hr>.
export function decouperEtapes(html) {
  const propre = nettoyerHtml(html);
  const morceaux = propre.split(/<hr[^>]*>/i).map((m) => m.trim()).filter(Boolean);
  return morceaux.length ? morceaux : [''];
}
