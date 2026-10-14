// Générateurs de questions « hors-ligne » : ils fonctionnent sans IA,
// directement à partir du texte des cours (définitions, phrases clés, chiffres).

const STOP = new Set(("le la les un une des du de d l au aux et ou mais donc or ni car que qui quoi dont où ce cet cette ces " +
  "son sa ses leur leurs mon ma mes ton ta tes notre nos votre vos il elle ils elles on nous vous je tu se sa " +
  "est sont être été était avoir a ont avait par pour avec sans sous sur dans en entre vers chez plus moins très " +
  "tout tous toute toutes autre autres même aussi ainsi alors comme lorsque quand si ne pas peut peuvent doit doivent " +
  "fait faire cela ceci celle celui ceux celles lequel laquelle lesquels selon après avant depuis pendant contre " +
  "elle-même lui leur y à â ça cas notamment exemple également afin quel quelle quels quelles chaque certains certaines " +
  "plusieurs dont toutefois cependant ensuite enfin car parce puisque article alinéa").split(/\s+/));

export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const normalize = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'")
    .replace(/[^a-z0-9%,.' -]/g, " ").replace(/\s+/g, " ").trim();

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

// Comparaison tolérante (accents, majuscules, petite faute de frappe).
export function reponseProche(saisie, attendu) {
  const a = normalize(saisie), b = normalize(attendu);
  if (!a) return false;
  if (a === b) return true;
  const tol = b.length >= 8 ? 2 : b.length >= 5 ? 1 : 0;
  return levenshtein(a, b) <= tol;
}

export function phrases(texte) {
  return texte
    .replace(/\r/g, "")
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.replace(/^[\s\-•*#>\d.)]+/, "").trim())
    .filter((s) => s.length >= 35 && s.length <= 400);
}

// Repère les définitions : « Terme : définition », « Le X est ... », « On appelle X ... ».
export function definitions(texte) {
  const defs = [];
  const vus = new Set();
  const add = (terme, def) => {
    terme = terme.replace(/^[\s\-•*#\d.)]+/, "").replace(/\*\*/g, "").trim();
    def = def.replace(/\*\*/g, "").trim().replace(/[.;]\s*$/, "");
    const k = normalize(terme);
    if (terme.length < 2 || terme.length > 70 || def.length < 12 || vus.has(k)) return;
    if (terme.split(/\s+/).length > 8) return;
    vus.add(k);
    defs.push({ terme, def });
  };
  for (const ligne of texte.split(/\n/)) {
    const m = ligne.match(/^\s*[-•*]?\s*([^:\n]{2,70}?)\s*[:=–—]\s+(.{12,})$/);
    if (m && !/https?$/i.test(m[1])) add(m[1], m[2]);
  }
  for (const p of phrases(texte)) {
    let m = p.match(/^(?:On appelle|On nomme|On entend par)\s+([^,]{2,60}),?\s+(.{12,})/i);
    if (m) { add(m[1], m[2]); continue; }
    m = p.match(/^(?:L[ea]s?\s+|L'|Un\s+|Une\s+)?([^,;:]{2,50}?)\s+(désigne|désignent|correspond à|correspondent à|consiste à|se définit comme|signifie|représente|(?:est|sont)\s+(?:un|une|le|la|les|l'|des|ce|celui|celle|ceux|l’))\s*(.{12,})/i);
    if (m && m[1].trim().split(/\s+/).length <= 5 && !/^(il|elle|ils|elles|cela|ce|ceci|c'|on)$/i.test(m[1].trim())) add(m[1], `${m[2]} ${m[3]}`);
  }
  return defs;
}

// Mots-clés : références d'articles, sigles, chiffres, puis termes fréquents.
export function motsCles(texte) {
  const scores = new Map();
  const bump = (w, s) => scores.set(w, (scores.get(w) || 0) + s);
  for (const m of texte.matchAll(/\b(?:[LRA]\.?\s?\d{2,4}(?:-\d+)*|art(?:icle)?\.?\s?\d+[\w-]*)/g)) bump(m[0].trim(), 6);
  for (const m of texte.matchAll(/\b[A-ZÉ]{2,}[A-Z0-9É]*\b/g)) if (!/^[IVXLC]+$/.test(m[0])) bump(m[0], 4);
  for (const m of texte.matchAll(/\b\d+(?:[.,]\d+)?\s?(?:%|€|euros?|jours?|mois|ans?|heures?|h)\b/g)) bump(m[0], 5);
  for (const m of texte.toLowerCase().matchAll(/[a-zàâçéèêëîïôûùüÿœ'-]{5,}/g)) {
    const w = m[0].replace(/^[ld]'/, "");
    if (!STOP.has(w) && w.length >= 5) bump(w, 1);
  }
  return [...scores.entries()].filter(([, s]) => s >= 2).sort((a, b) => b[1] - a[1]).map(([w]) => w);
}

const memeNature = (a, b) => /\d/.test(a) === /\d/.test(b);

function distracteurs(bonne, pool, n = 3) {
  const cand = shuffle(pool.filter((x) => normalize(x) !== normalize(bonne) && memeNature(x, bonne)));
  const autres = shuffle(pool.filter((x) => normalize(x) !== normalize(bonne) && !cand.includes(x)));
  return [...cand, ...autres].slice(0, n);
}

function variantesChiffre(v) {
  const m = v.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return [];
  const n = parseFloat(m[1].replace(",", "."));
  const opts = new Set([n * 2, Math.max(1, Math.round(n / 2)), n + (n >= 10 ? 10 : 1), n * 3]);
  opts.delete(n);
  return [...opts].map((x) => v.replace(m[1], String(Number.isInteger(x) ? x : x.toFixed(2)).replace(".", ",")));
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const contient = (p, w) => new RegExp(`(^|[^\\p{L}\\d])${escRe(w)}(?=$|[^\\p{L}\\d])`, "iu").test(p);

// Restreint le texte au thème demandé (paragraphes contenant le mot-clé).
export function filtrerTexte(texte, focus) {
  if (!focus || !focus.trim()) return texte;
  const f = normalize(focus);
  const blocs = texte.split(/\n\s*\n/);
  const garde = blocs.filter((b) => normalize(b).includes(f));
  return garde.length ? garde.join("\n\n") : texte;
}

// ---------- Générateurs ----------

export function genQCM(texte, n) {
  const defs = definitions(texte);
  const kws = motsCles(texte);
  const out = [];
  const termes = defs.map((d) => d.terme);
  for (const d of shuffle(defs)) {
    if (out.length >= n) break;
    if (termes.length >= 4 && Math.random() < 0.6) {
      out.push({ type: "qcm", question: `Quelle notion correspond à : « ${d.def} » ?`,
        ...melange(d.terme, distracteurs(d.terme, termes)), explication: `${d.terme} : ${d.def}` });
    } else if (defs.length >= 4) {
      const autres = distracteurs(d.def, defs.map((x) => x.def));
      out.push({ type: "qcm", question: `Que désigne « ${d.terme} » ?`, ...melange(d.def, autres), explication: `${d.terme} : ${d.def}` });
    }
  }
  for (const p of shuffle(phrases(texte))) {
    if (out.length >= n) break;
    const k = kws.find((w) => contient(p, w) && w.length < p.length / 2);
    if (!k) continue;
    let pool = distracteurs(k, kws.slice(0, 60));
    if (/\d/.test(k)) pool = [...variantesChiffre(k), ...pool].slice(0, 3);
    if (pool.length < 2) continue;
    const q = p.replace(new RegExp(escRe(k), "i"), "_____");
    out.push({ type: "qcm", question: `Complétez : ${q}`, ...melange(k, pool), explication: p });
  }
  return dedoublonne(out).slice(0, n);
}

function melange(bonne, autres) {
  const choix = shuffle([bonne, ...autres]);
  return { choix, bonne: choix.indexOf(bonne) };
}

export function genTrous(texte, n) {
  const kws = motsCles(texte).slice(0, 80);
  const out = [];
  for (const p of shuffle(phrases(texte))) {
    if (out.length >= n) break;
    const presents = kws.filter((w) => contient(p, w)).slice(0, p.length > 160 ? 2 : 1);
    if (!presents.length) continue;
    let t = p;
    const reponses = [];
    for (const w of presents) {
      const re = new RegExp(escRe(w), "i");
      const m = t.match(re);
      if (!m) continue;
      t = t.replace(re, `{{${reponses.length}}}`);
      reponses.push(m[0]);
    }
    if (reponses.length) out.push({ type: "trou", texte: t, reponses, explication: p });
  }
  return out;
}

export function genVF(texte, n) {
  const defs = definitions(texte);
  const out = [];
  for (const d of shuffle(defs)) {
    if (out.length >= n) break;
    const faux = Math.random() < 0.5 && defs.length > 1;
    if (faux) {
      const autre = shuffle(defs.filter((x) => x !== d))[0];
      out.push({ type: "vf", affirmation: `${d.terme} : ${autre.def}`, vrai: false, explication: `Faux. ${d.terme} : ${d.def}` });
    } else out.push({ type: "vf", affirmation: `${d.terme} : ${d.def}`, vrai: true, explication: "Vrai, c'est la définition du cours." });
  }
  for (const p of shuffle(phrases(texte))) {
    if (out.length >= n) break;
    const num = p.match(/\b\d+(?:[.,]\d+)?\s?(?:%|€|euros?|jours?|mois|ans?|heures?|h)\b/);
    if (num && Math.random() < 0.6) {
      const v = variantesChiffre(num[0])[0];
      out.push({ type: "vf", affirmation: p.replace(num[0], v), vrai: false, explication: `Faux. Le cours dit : ${p}` });
    } else out.push({ type: "vf", affirmation: p, vrai: true, explication: "Vrai, phrase extraite du cours." });
  }
  return out.slice(0, n);
}

export function genOuvertes(texte, n) {
  const out = [];
  for (const d of shuffle(definitions(texte))) {
    if (out.length >= n) break;
    out.push({ type: "ouverte", question: `Définissez et expliquez : ${d.terme}`, reponse: `${d.terme} : ${d.def}` });
  }
  // Titres de parties → « Que dit le cours sur … »
  const lignes = texte.split("\n");
  for (let i = 0; i < lignes.length && out.length < n; i++) {
    const l = lignes[i].trim();
    const titre = l.match(/^(?:#{1,4}\s+|[IVX]+[.)-]\s+|\d+[.)-]\s+|[A-Z][.)]\s+)(.{4,80})$/);
    if (!titre) continue;
    const suite = lignes.slice(i + 1, i + 12).join(" ").trim();
    if (suite.length > 60) out.push({ type: "ouverte", question: `Présentez : ${titre[1].replace(/[:#]/g, "").trim()}`, reponse: suite.slice(0, 700) });
  }
  return shuffle(out).slice(0, n);
}

export function genCartes(texte) {
  return definitions(texte).map((d) => ({ recto: d.terme, verso: d.def }));
}

export function genMixte(texte, n) {
  const q = Math.ceil(n / 4);
  return shuffle([...genQCM(texte, q), ...genTrous(texte, q), ...genVF(texte, q), ...genOuvertes(texte, q)]).slice(0, n);
}

function dedoublonne(qs) {
  const vus = new Set();
  return qs.filter((q) => {
    const k = normalize(q.question || q.texte || q.affirmation);
    if (vus.has(k)) return false;
    vus.add(k);
    return true;
  });
}
