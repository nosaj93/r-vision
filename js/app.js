import * as S from "./store.js";
import * as G from "./generators.js";
import * as AI from "./ai.js";
import { EPREUVES, MATIERES, BANQUE, SOURCES_ANNALES, lienRecherche } from "./bts-data.js";

// ---------- Utilitaires ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const vue = () => $("#vue");

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Mini rendu Markdown (titres, gras, italique, listes, liens).
function md(src) {
  const lignes = esc(src).split("\n");
  let html = "", liste = false;
  const inline = (t) => t
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  for (const l of lignes) {
    const h = l.match(/^(#{1,4})\s+(.*)/);
    const li = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (li) { if (!liste) { html += "<ul>"; liste = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (liste) { html += "</ul>"; liste = false; }
    if (h) html += `<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`;
    else if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  return html + (liste ? "</ul>" : "");
}

function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

const fmtDate = (ms) => new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const sur20 = (a, b) => (b ? Math.round((a / b) * 200) / 10 : 0);

function chargement(msg) {
  vue().innerHTML = `<div class="chargement"><div class="spinner"></div><p>${esc(msg)}</p><p class="muted">Cela peut prendre jusqu'à une minute.</p></div>`;
}

function texteDesCours(ids, focus) {
  const txt = ids.map((id) => S.getCours(id)).filter(Boolean).map((c) => `# ${c.titre}\n${c.contenu}`).join("\n\n");
  return focus ? G.filtrerTexte(txt, focus) : txt;
}

// Sélecteur de cours (cases à cocher), réutilisé par plusieurs pages.
function selecteurCours(name = "cours", coches = []) {
  const cours = S.listCours();
  if (!cours.length) return `<p class="muted">Aucun cours enregistré. <a href="#cours/nouveau">Ajoute ton premier cours</a>.</p>`;
  const parMatiere = {};
  for (const c of cours) (parMatiere[c.matiere || "Autre"] ||= []).push(c);
  return `<div class="select-cours">
    <div class="row gap-s"><button type="button" class="btn-lien" data-tout="${name}">Tout cocher</button><button type="button" class="btn-lien" data-rien="${name}">Tout décocher</button></div>
    ${Object.entries(parMatiere).map(([m, cs]) => `<fieldset><legend>${esc(m)}</legend>
      ${cs.map((c) => `<label class="check"><input type="checkbox" name="${name}" value="${c.id}" ${coches.includes(c.id) ? "checked" : ""}> ${esc(c.titre)}${c.chapitre ? ` <span class="muted">· ${esc(c.chapitre)}</span>` : ""}</label>`).join("")}
    </fieldset>`).join("")}
  </div>`;
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tout],[data-rien]");
  if (!t) return;
  const name = t.dataset.tout || t.dataset.rien;
  $$(`input[name="${name}"]`).forEach((i) => (i.checked = !!t.dataset.tout));
});
const coches = (form, name = "cours") => $$(`input[name="${name}"]:checked`, form).map((i) => i.value);

// ---------- Import de fichiers (txt, md, pdf, docx) ----------
async function lireFichier(file) {
  const nom = file.name.toLowerCase();
  if (nom.endsWith(".pdf")) {
    const pdfjs = await import("./vendor/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let txt = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const c = await page.getTextContent();
      let ligne = "", y = null;
      for (const it of c.items) {
        const yy = it.transform?.[5];
        if (y !== null && Math.abs(yy - y) > 2) { txt += ligne.trim() + "\n"; ligne = ""; }
        ligne += it.str + (it.hasEOL ? "\n" : "");
        y = yy;
      }
      txt += ligne.trim() + "\n\n";
    }
    if (txt.trim().length < 20) throw new Error("Ce PDF semble être une image scannée : le texte n'a pas pu être extrait.");
    return txt.replace(/\n{3,}/g, "\n\n");
  }
  if (nom.endsWith(".docx")) {
    if (!window.mammoth) await new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = "js/vendor/mammoth.browser.min.js";
      s.onload = ok; s.onerror = () => ko(new Error("Impossible de charger le lecteur Word"));
      document.head.append(s);
    });
    const r = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return r.value;
  }
  return await file.text();
}

// =====================================================================
// Routeur
// =====================================================================
const ROUTES = {
  accueil: pageAccueil,
  cours: pageCours,
  reviser: pageReviser,
  examen: pageExamen,
  annales: pageAnnales,
  progres: pageProgres,
  reglages: pageReglages,
};

function router() {
  const [page, ...args] = (location.hash.slice(1) || "accueil").split("/");
  $$("nav a").forEach((a) => a.classList.toggle("actif", a.getAttribute("href") === "#" + page));
  clearInterval(window.__chrono);
  (ROUTES[page] || pageAccueil)(...args.map(decodeURIComponent));
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", router);
// Un lien vers la page déjà affichée (ex. « Réviser » pendant un quiz) recharge quand même la page.
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (a && a.getAttribute("href") === location.hash) router();
});

// =====================================================================
// Accueil
// =====================================================================
function pageAccueil() {
  const d = S.db();
  const dues = S.cartesDues(d.cours.map((c) => c.id)).length;
  const h = d.historique;
  const moy = h.length ? sur20(h.reduce((a, r) => a + r.score, 0), h.reduce((a, r) => a + r.total, 0)) : null;
  vue().innerHTML = `
  <section class="hero">
    <h1>Bienvenue sur R-Vision 🎓</h1>
    <p>Ton espace de révision pour le <strong>BTS Assurance</strong> : range tes cours, puis entraîne-toi avec des QCM, textes à trous, vrai/faux, questions ouvertes, flashcards et examens blancs.</p>
  </section>
  <div class="stats">
    <div class="stat"><span>${d.cours.length}</span>cours enregistrés</div>
    <div class="stat"><span>${h.length}</span>séances de révision</div>
    <div class="stat"><span>${moy ?? "–"}</span>moyenne /20</div>
    <div class="stat"><span>${dues}</span>flashcards à revoir</div>
  </div>
  <div class="grille">
    <a class="carte-lien" href="#cours/import"><b>📥 Ajouter mes cours</b><span>Importe tous tes PDF / Word d'un coup, ou un dossier entier.</span></a>
    <a class="carte-lien" href="#reviser"><b>🧠 Réviser</b><span>QCM, textes à trous, vrai/faux, questions ouvertes, flashcards.</span></a>
    <a class="carte-lien" href="#examen"><b>📝 Examen blanc</b><span>Étude de cas chronométrée notée sur 20, comme au BTS.</span></a>
    <a class="carte-lien" href="#annales"><b>🔎 Annales BTS</b><span>Épreuves, sujets types, recherche d'anciens sujets.</span></a>
  </div>
  ${!AI.aiDisponible() ? `<div class="info">💡 L'app fonctionne <b>sans IA</b> (questions générées automatiquement à partir de tes cours). Pour des questions de meilleure qualité, la correction de tes réponses rédigées et les examens blancs complets, ajoute une clé API Claude dans <a href="#reglages">Réglages</a>.</div>` : ""}
  <h2>Comment ça marche ?</h2>
  <ol class="etapes">
    <li><b>Enregistre tes cours</b> dans « Mes cours » (un cours par chapitre, c'est l'idéal). Les définitions sous la forme <code>Notion : définition</code> sont très bien exploitées.</li>
    <li><b>Choisis ce que tu veux travailler</b> : un ou plusieurs cours, et éventuellement un thème précis (ex. « prescription », « IRSI »).</li>
    <li><b>Choisis un mode de révision</b> et lance-toi. Les erreurs sont corrigées et expliquées.</li>
    <li><b>Fais des examens blancs</b> et suis ta progression dans « Progrès ».</li>
  </ol>`;
}

// =====================================================================
// Cours
// =====================================================================
function pageCours(action, id) {
  if (action === "nouveau") return formCours();
  if (action === "import") return importMultiple();
  if (action === "edit") return formCours(S.getCours(id));
  if (action === "voir") return voirCours(S.getCours(id));
  const cours = S.listCours();
  vue().innerHTML = `
  <div class="row entre"><h1>Mes cours</h1><div class="actions"><a class="btn" href="#cours/import">📥 Importer plusieurs cours</a><a class="btn secondaire" href="#cours/nouveau">➕ Nouveau cours</a></div></div>
  <input id="recherche" type="search" placeholder="Rechercher dans mes cours (titre, matière, contenu)…">
  <div id="liste"></div>`;
  const afficher = (q = "") => {
    const nq = G.normalize(q);
    const res = cours.filter((c) => !nq || G.normalize(`${c.titre} ${c.matiere} ${c.chapitre} ${c.contenu}`).includes(nq));
    $("#liste").innerHTML = res.length ? res.map((c) => `
      <article class="item">
        <div><h3><a href="#cours/voir/${c.id}">${esc(c.titre)}</a></h3>
        <p class="muted">${esc(c.matiere || "")}${c.chapitre ? " · " + esc(c.chapitre) : ""} · ${c.contenu.length.toLocaleString("fr-FR")} caractères · modifié le ${fmtDate(c.modifie)}</p></div>
        <div class="actions">
          <a class="btn petit" href="#reviser/${c.id}">Réviser</a>
          <a class="btn petit secondaire" href="#cours/edit/${c.id}">Modifier</a>
        </div>
      </article>`).join("") : `<p class="vide">${cours.length ? "Aucun résultat." : "Tu n'as encore aucun cours. Clique sur « Importer plusieurs cours » pour ajouter tous tes fichiers d'un coup."}</p>`;
  };
  $("#recherche").addEventListener("input", (e) => afficher(e.target.value));
  afficher();
}

// ----- Import de plusieurs fichiers d'un coup -----
const EXTENSIONS = /\.(pdf|docx|txt|md)$/i;

// Devine la matière à partir du nom du fichier (ex. « E41 - IRSI.pdf », « CEJM chap 2.docx »).
function devinerMatiere(nom) {
  const n = G.normalize(nom);
  const ep = EPREUVES.find((e) => new RegExp(`(^|[^a-z0-9])${e.id.toLowerCase()}([^0-9]|$)`).test(n));
  if (ep) return `${ep.id} — ${ep.nom}`;
  const regles = [
    [/cejm|economi|manag|droit des contrats/, "E6"],
    [/sinistre|irsa|irsi|indemnis|expertise|badinter/, "E41"],
    [/digital|numerique|rgpd|informatique/, "E5"],
    [/culture gen|synthese/, "E1"],
    [/anglais|english/, "E2"],
  ];
  for (const [re, id] of regles) if (re.test(n)) { const e = EPREUVES.find((x) => x.id === id); return `${e.id} — ${e.nom}`; }
  if (/vie|prevoyance|sante|personne|emprunteur|retraite/.test(n)) return "Assurances de personnes";
  if (/iard|auto|habitation|mrh|responsabilite|incendie|vol/.test(n)) return "Assurances de biens et de responsabilité (IARD)";
  return "";
}

function importMultiple() {
  let fichiers = []; // { file, titre, matiere, choisi, statut }
  const existants = new Set(S.listCours().map((c) => G.normalize(c.titre)));
  vue().innerHTML = `
  <h1>Importer plusieurs cours</h1>
  <p>Sélectionne tous tes fichiers d'un coup (PDF, Word .docx, .txt, .md) : <b>chaque fichier devient un cours</b>.</p>
  <label class="zone-depot" id="zone">
    <input type="file" id="multi" multiple accept=".pdf,.docx,.txt,.md" hidden>
    <span class="grand-icone">📂</span>
    <b>Clique pour choisir tes fichiers</b>
    <span class="muted">ou glisse-dépose-les ici (Ctrl+A dans la fenêtre pour tout sélectionner)</span>
  </label>
  <p class="centre-texte"><label class="btn-lien">ou importer un dossier entier<input type="file" id="dossier" webkitdirectory multiple hidden></label></p>
  <div id="apercu"></div>`;
  const ajouter = (liste) => {
    const nouveaux = [...liste].filter((f) => EXTENSIONS.test(f.name) && !fichiers.some((x) => x.file.name === f.name && x.file.size === f.size));
    const ignores = liste.length - nouveaux.length;
    for (const file of nouveaux) {
      const titre = file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
      const doublon = existants.has(G.normalize(titre));
      fichiers.push({ file, titre, matiere: devinerMatiere(file.name), choisi: !doublon, statut: doublon ? "déjà dans tes cours" : "" });
    }
    if (ignores > 0 && nouveaux.length < liste.length) toast(`${ignores} fichier(s) ignoré(s) (format non pris en charge ou déjà dans la liste).`);
    afficher();
  };
  const afficher = () => {
    if (!fichiers.length) { $("#apercu").innerHTML = ""; return; }
    const nb = fichiers.filter((f) => f.choisi).length;
    $("#apercu").innerHTML = `
    <div class="encart">
      <div class="row entre"><b>${fichiers.length} fichier(s) — ${nb} sélectionné(s)</b>
        <div class="row gap-s"><button type="button" class="btn-lien" id="tout">Tout sélectionner</button><button type="button" class="btn-lien" id="rien">Tout désélectionner</button></div></div>
      <label>Matière pour tous les fichiers sélectionnés
        <select id="matiere-tous"><option value="">— garder la matière de chaque ligne —</option>${MATIERES.map((m) => `<option>${esc(m)}</option>`).join("")}</select></label>
      <table class="tableau import">${fichiers.map((f, i) => `
        <tr class="${f.statut === "importé ✔" ? "fait" : ""}">
          <td><input type="checkbox" data-i="${i}" class="choix-f" ${f.choisi ? "checked" : ""} ${f.statut === "importé ✔" ? "disabled" : ""}></td>
          <td><input data-i="${i}" class="titre-f" value="${esc(f.titre)}"><small class="muted">${esc(f.file.name)} · ${Math.ceil(f.file.size / 1024)} Ko</small></td>
          <td><select data-i="${i}" class="matiere-f"><option value="">Matière…</option>${MATIERES.map((m) => `<option ${m === f.matiere ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></td>
          <td class="statut ${/erreur/.test(f.statut) ? "ko-texte" : ""}">${esc(f.statut)}</td>
        </tr>`).join("")}</table>
      <div class="row gap"><button class="btn grand" id="go" ${nb ? "" : "disabled"}>📥 Importer ${nb} cours</button><button type="button" class="btn secondaire" id="vider">Vider la liste</button></div>
    </div>`;
    $$(".choix-f").forEach((c) => (c.onchange = () => { fichiers[c.dataset.i].choisi = c.checked; afficher(); }));
    $$(".titre-f").forEach((t) => (t.oninput = () => (fichiers[t.dataset.i].titre = t.value)));
    $$(".matiere-f").forEach((m) => (m.onchange = () => (fichiers[m.dataset.i].matiere = m.value)));
    $("#tout").onclick = () => { fichiers.forEach((f) => f.statut !== "importé ✔" && (f.choisi = true)); afficher(); };
    $("#rien").onclick = () => { fichiers.forEach((f) => (f.choisi = false)); afficher(); };
    $("#matiere-tous").onchange = (e) => { if (e.target.value) fichiers.forEach((f) => f.choisi && (f.matiere = e.target.value)); afficher(); };
    $("#vider").onclick = () => { fichiers = []; afficher(); };
    $("#go").onclick = importer;
  };
  const importer = async () => {
    const aFaire = fichiers.filter((f) => f.choisi);
    $("#go").disabled = true;
    let ok = 0;
    for (const [k, f] of aFaire.entries()) {
      $("#go").textContent = `⏳ Import ${k + 1} / ${aFaire.length}…`;
      try {
        const contenu = (await lireFichier(f.file)).trim();
        if (!contenu) throw new Error("fichier vide");
        S.saveCours({ titre: f.titre.trim() || f.file.name, matiere: f.matiere || "Autre", chapitre: "", contenu });
        f.statut = "importé ✔"; f.choisi = false; ok++;
      } catch (err) {
        f.statut = "erreur : " + err.message; f.choisi = false;
      }
    }
    afficher();
    const erreurs = aFaire.length - ok;
    toast(`${ok} cours importé(s)${erreurs ? `, ${erreurs} erreur(s)` : ""}.`, erreurs ? "err" : "ok");
    if (!erreurs) setTimeout(() => (location.hash = "#cours"), 900);
  };
  $("#multi").onchange = (e) => { ajouter(e.target.files); e.target.value = ""; };
  $("#dossier").onchange = (e) => { ajouter(e.target.files); e.target.value = ""; };
  const zone = $("#zone");
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("survol"); };
  zone.ondragleave = () => zone.classList.remove("survol");
  zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove("survol"); ajouter(e.dataTransfer.files); };
}

function formCours(c = {}) {
  vue().innerHTML = `
  <h1>${c.id ? "Modifier le cours" : "Nouveau cours"}</h1>
  <form id="f" class="form">
    <label>Titre du cours<input name="titre" required value="${esc(c.titre)}" placeholder="Ex. : La formation du contrat d'assurance"></label>
    <div class="row gap">
      <label class="flex">Matière / épreuve
        <select name="matiere">${MATIERES.map((m) => `<option ${m === c.matiere ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
      <label class="flex">Chapitre / tags (optionnel)<input name="chapitre" value="${esc(c.chapitre)}" placeholder="Ex. : Chapitre 3, IARD"></label>
    </div>
    <label>Importer un fichier (PDF, Word .docx, .txt, .md)
      <input type="file" id="fichier" accept=".pdf,.docx,.txt,.md,text/plain"></label>
    <label>Contenu du cours
      <textarea name="contenu" required rows="18" placeholder="Colle ici ton cours.&#10;&#10;Astuce : écris tes définitions sous la forme&#10;Prescription biennale : délai de 2 ans pour agir...">${esc(c.contenu)}</textarea></label>
    <div class="row gap">
      <button class="btn">💾 Enregistrer</button>
      <a class="btn secondaire" href="#cours">Annuler</a>
      ${c.id ? `<button type="button" id="suppr" class="btn danger">Supprimer</button>` : ""}
    </div>
  </form>`;
  $("#fichier").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      toast("Lecture du fichier…");
      const txt = await lireFichier(f);
      const ta = $("textarea[name=contenu]");
      ta.value = ta.value ? ta.value + "\n\n" + txt : txt;
      if (!$("input[name=titre]").value) $("input[name=titre]").value = f.name.replace(/\.[^.]+$/, "");
      toast("Fichier importé ✔", "ok");
    } catch (err) { toast(err.message, "err"); }
  });
  $("#f").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const saved = S.saveCours({ ...(c.id ? { id: c.id } : {}), ...fd });
    toast("Cours enregistré ✔", "ok");
    location.hash = "#cours/voir/" + saved.id;
  });
  $("#suppr")?.addEventListener("click", () => {
    if (confirm("Supprimer définitivement ce cours ?")) { S.deleteCours(c.id); location.hash = "#cours"; }
  });
}

function voirCours(c) {
  if (!c) { location.hash = "#cours"; return; }
  const defs = G.definitions(c.contenu);
  vue().innerHTML = `
  <div class="row entre"><div><h1>${esc(c.titre)}</h1><p class="muted">${esc(c.matiere)}${c.chapitre ? " · " + esc(c.chapitre) : ""}</p></div>
    <div class="actions"><a class="btn" href="#reviser/${c.id}">🧠 Réviser ce cours</a><a class="btn secondaire" href="#cours/edit/${c.id}">Modifier</a></div></div>
  ${defs.length ? `<details class="encart"><summary>📌 ${defs.length} définition(s) repérée(s) automatiquement</summary><dl>${defs.map((d) => `<dt>${esc(d.terme)}</dt><dd>${esc(d.def)}</dd>`).join("")}</dl></details>` : ""}
  <article class="contenu-cours">${md(c.contenu)}</article>`;
}

// =====================================================================
// Réviser
// =====================================================================
const MODES = [
  { id: "qcm", nom: "QCM", icone: "☑️", desc: "Choisis la bonne réponse parmi 4." },
  { id: "trou", nom: "Texte à trous", icone: "✏️", desc: "Retrouve les mots clés manquants." },
  { id: "vf", nom: "Vrai ou faux", icone: "⚖️", desc: "Repère les pièges (délais, articles, montants)." },
  { id: "ouverte", nom: "Questions ouvertes", icone: "💬", desc: "Rédige ta réponse, elle est corrigée." },
  { id: "mixte", nom: "Interrogation complète", icone: "🎯", desc: "Mélange de tous les formats sur tout le cours." },
  { id: "carte", nom: "Flashcards", icone: "🃏", desc: "Mémorisation espacée (système de Leitner)." },
];

function pageReviser(coursId) {
  const ia = AI.aiDisponible();
  vue().innerHTML = `
  <h1>Réviser</h1>
  <form id="f" class="form">
    <h2>1. Sur quels cours ?</h2>
    ${selecteurCours("cours", coursId ? [coursId] : [])}
    <label>Partie / thème à travailler en priorité (optionnel)
      <input name="focus" placeholder="Ex. : prescription, loi Badinter, IRSI, règle proportionnelle…"></label>
    <h2>2. Quel mode ?</h2>
    <div class="modes">${MODES.map((m, i) => `
      <label class="mode"><input type="radio" name="mode" value="${m.id}" ${i === 0 ? "checked" : ""}>
        <span><b>${m.icone} ${m.nom}</b><small>${m.desc}</small></span></label>`).join("")}</div>
    <h2>3. Réglages</h2>
    <div class="row gap">
      <label class="flex">Nombre de questions<input type="number" name="n" value="10" min="3" max="40"></label>
      <label class="flex">Difficulté<select name="difficulte"><option>facile</option><option selected>moyen (niveau BTS)</option><option>difficile</option></select></label>
      <label class="flex">Générateur
        <select name="source">
          <option value="ia" ${ia ? "selected" : "disabled"}>IA Claude (recommandé)${ia ? "" : " — clé API requise"}</option>
          <option value="local" ${ia ? "" : "selected"}>Automatique hors-ligne</option>
        </select></label>
    </div>
    <button class="btn grand">🚀 Commencer</button>
  </form>`;
  $("#f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const ids = coches(e.target);
    if (!ids.length) return toast("Coche au moins un cours.", "err");
    const opts = { ids, focus: fd.get("focus").trim(), mode: fd.get("mode"), n: +fd.get("n"), difficulte: fd.get("difficulte"), source: fd.get("source") };
    if (opts.mode === "carte") return sessionCartes(opts);
    lancerQuiz(opts);
  });
}

async function lancerQuiz(opts) {
  const texte = texteDesCours(opts.ids, opts.focus);
  let questions;
  try {
    if (opts.source === "ia") {
      chargement("Claude prépare tes questions…");
      questions = (await AI.genererQuestions({ texte, focus: opts.focus, mode: opts.mode, n: opts.n, difficulte: opts.difficulte }))
        .filter((q) => q.type !== "carte");
    } else {
      const gen = { qcm: G.genQCM, trou: G.genTrous, vf: G.genVF, ouverte: G.genOuvertes, mixte: G.genMixte }[opts.mode];
      questions = gen(texte, opts.n);
    }
  } catch (err) {
    vue().innerHTML = `<div class="erreur"><p>❌ ${esc(err.message)}</p><a class="btn" href="#reviser">Retour</a></div>`;
    return;
  }
  if (!questions.length) {
    vue().innerHTML = `<div class="erreur"><p>Je n'ai pas réussi à fabriquer des questions de ce type à partir de ce cours.</p>
      <p class="muted">Astuces : ajoute des définitions sous la forme « Notion : définition », des phrases complètes, ou utilise l'IA.</p><a class="btn" href="#reviser">Retour</a></div>`;
    return;
  }
  quizUnParUn(questions, opts, texte);
}

// ----- Rendu & correction d'une question -----
function htmlQuestion(q, i) {
  switch (q.type) {
    case "qcm":
      return `<p class="enonce">${esc(q.question)}</p><div class="choix">${q.choix.map((c, j) => `
        <label class="choix-item"><input type="radio" name="q${i}" value="${j}"> ${esc(c)}</label>`).join("")}</div>`;
    case "vf":
      return `<p class="enonce">${esc(q.affirmation)}</p><div class="choix ligne">
        <label class="choix-item"><input type="radio" name="q${i}" value="1"> Vrai</label>
        <label class="choix-item"><input type="radio" name="q${i}" value="0"> Faux</label></div>`;
    case "trou":
      return `<p class="enonce trous">${esc(q.texte).replace(/\{\{(\d+)\}\}/g, (_, k) =>
        `<input class="trou" name="q${i}_${k}" autocomplete="off" size="${Math.max(6, (q.reponses[k] || "").length + 2)}">`)}</p>`;
    case "ouverte":
      return `<p class="enonce">${esc(q.question)}</p><textarea name="q${i}" rows="6" placeholder="Rédige ta réponse…"></textarea>`;
    default: return "";
  }
}

// Renvoie { score (0..1) | null si à corriger, html }
function corrigerQuestion(q, i, root) {
  const val = (n) => $(`[name="${n}"]:checked`, root)?.value ?? $(`[name="${n}"]`, root)?.value;
  if (q.type === "qcm") {
    const v = val(`q${i}`);
    const ok = +v === q.bonne;
    $$(`[name="q${i}"]`, root).forEach((inp) => inp.closest("label").classList.add(+inp.value === q.bonne ? "bon" : inp.checked ? "faux" : "neutre"));
    return { score: ok ? 1 : 0, html: `${ok ? "✅ Bonne réponse" : `❌ La bonne réponse était : <b>${esc(q.choix[q.bonne])}</b>`}${q.explication ? `<p>${esc(q.explication)}</p>` : ""}` };
  }
  if (q.type === "vf") {
    const v = val(`q${i}`);
    const ok = v !== undefined && (v === "1") === q.vrai;
    return { score: ok ? 1 : 0, html: `${ok ? "✅ Exact" : `❌ C'était <b>${q.vrai ? "VRAI" : "FAUX"}</b>`}${q.explication ? `<p>${esc(q.explication)}</p>` : ""}` };
  }
  if (q.type === "trou") {
    let bons = 0;
    q.reponses.forEach((r, k) => {
      const inp = $(`[name="q${i}_${k}"]`, root);
      const ok = G.reponseProche(inp.value, r);
      if (ok) bons++;
      inp.classList.add(ok ? "bon" : "faux");
      inp.readOnly = true;
      if (!ok) inp.insertAdjacentHTML("afterend", `<span class="correction"> → ${esc(r)}</span>`);
    });
    return { score: bons / q.reponses.length, html: `${bons === q.reponses.length ? "✅ Parfait" : `${bons}/${q.reponses.length} bonne(s) réponse(s)`}${q.explication ? `<p>${esc(q.explication)}</p>` : ""}` };
  }
  return { score: null, html: "" };
}

function quizUnParUn(questions, opts, texteCours) {
  let i = 0, total = 0;
  const details = [];
  const afficher = () => {
    const q = questions[i];
    vue().innerHTML = `
    <div class="quiz">
      <div class="progression"><div style="width:${pct(i, questions.length)}%"></div></div>
      <p class="muted">Question ${i + 1} / ${questions.length} · score : ${Math.round(total * 10) / 10}</p>
      <form id="q" class="question">${htmlQuestion(q, i)}
        <div id="retour"></div>
        <div class="row gap"><button class="btn" id="valider">Valider</button><button type="button" class="btn secondaire" id="passer">Passer</button></div>
      </form>
    </div>`;
    const form = $("#q");
    $("input.trou", form)?.focus();
    $("#passer").onclick = () => suivant(0, "passée");
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (form.dataset.fait) return suivant();
      if (q.type === "ouverte") return corrigerOuverte(q, form);
      const r = corrigerQuestion(q, i, form);
      afficherRetour(r.score, r.html);
    };
  };
  const afficherRetour = (score, html) => {
    const form = $("#q");
    form.dataset.fait = "1";
    form.dataset.score = score;
    $("#retour").innerHTML = `<div class="feedback ${score >= 0.99 ? "ok" : score > 0 ? "moyen" : "ko"}">${html}</div>`;
    $("#valider").textContent = i + 1 < questions.length ? "Question suivante →" : "Voir mon résultat";
    $("#passer").remove();
    $("#valider").focus();
  };
  const corrigerOuverte = async (q, form) => {
    const rep = $("textarea", form).value;
    if (AI.aiDisponible()) {
      $("#valider").disabled = true;
      $("#retour").innerHTML = `<p class="muted">⏳ Correction en cours…</p>`;
      try {
        const r = await AI.corriger([{ question: q.question, bareme: 1, attendu: q.reponse, reponse: rep }], texteCours);
        const c = r.corrections[0];
        $("#valider").disabled = false;
        return afficherRetour(c.points, `<b>${c.points} / 1</b><p>${esc(c.commentaire)}</p><details open><summary>Corrigé</summary>${md(c.corrige)}</details>`);
      } catch (err) {
        $("#valider").disabled = false;
        toast(err.message, "err");
      }
    }
    // Auto-évaluation
    $("#retour").innerHTML = `<div class="feedback"><b>Réponse attendue :</b>${md(q.reponse || q.explication || "")}
      <p>Comment t'en es-tu sorti(e) ?</p>
      <div class="row gap"><button type="button" class="btn petit" data-auto="1">J'avais juste</button><button type="button" class="btn petit secondaire" data-auto="0.5">En partie</button><button type="button" class="btn petit danger" data-auto="0">Raté</button></div></div>`;
    $("#valider").style.display = "none";
    $$("[data-auto]").forEach((b) => (b.onclick = () => { $("#valider").style.display = ""; afficherRetour(+b.dataset.auto, `<b>Auto-évaluation : ${b.textContent}</b>`); }));
  };
  const suivant = (forced) => {
    const s = forced ?? +$("#q").dataset.score;
    total += s || 0;
    details.push({ q: questions[i], score: s || 0 });
    i++;
    if (i < questions.length) afficher();
    else resultat();
  };
  const resultat = () => {
    S.addResultat({ mode: opts.mode, coursIds: opts.ids, focus: opts.focus, score: total, total: questions.length });
    const note = sur20(total, questions.length);
    const rates = details.filter((d) => d.score < 1);
    vue().innerHTML = `
    <div class="resultat">
      <h1>${note >= 14 ? "🎉 Bravo !" : note >= 10 ? "👍 Pas mal !" : "💪 Continue !"}</h1>
      <p class="note">${note} <small>/ 20</small></p>
      <p>${Math.round(total * 10) / 10} point(s) sur ${questions.length}</p>
      <div class="row gap centre"><button class="btn" id="refaire">🔁 Nouvelle série</button><a class="btn secondaire" href="#reviser">Changer de mode</a></div>
    </div>
    ${rates.length ? `<h2>À retravailler</h2>${rates.map((d) => `<div class="item col"><b>${esc(d.q.question || d.q.affirmation || d.q.texte?.replace(/\{\{\d+\}\}/g, "____"))}</b>
      <span class="muted">${esc(d.q.type === "qcm" ? d.q.choix[d.q.bonne] : d.q.type === "vf" ? (d.q.vrai ? "Vrai" : "Faux") : d.q.type === "trou" ? d.q.reponses.join(", ") : "")}</span>
      ${d.q.explication ? `<span>${esc(d.q.explication)}</span>` : ""}</div>`).join("")}` : ""}`;
    $("#refaire").onclick = () => lancerQuiz(opts);
  };
  afficher();
}

// ----- Flashcards (Leitner) -----
async function sessionCartes(opts) {
  // Génère/complète le paquet des cours choisis
  for (const id of opts.ids) {
    const c = S.getCours(id);
    S.upsertCartes(id, G.genCartes(G.filtrerTexte(c.contenu, opts.focus)));
  }
  if (opts.source === "ia") {
    try {
      chargement("Claude crée tes flashcards…");
      for (const id of opts.ids) {
        const c = S.getCours(id);
        const qs = await AI.genererQuestions({ texte: G.filtrerTexte(c.contenu, opts.focus), focus: opts.focus, mode: "carte", n: opts.n, difficulte: opts.difficulte });
        S.upsertCartes(id, qs.map((q) => ({ recto: q.recto, verso: q.verso + (q.explication ? `\n\n💡 ${q.explication}` : "") })));
      }
    } catch (err) { toast(err.message, "err"); }
  }
  let paquet = G.shuffle(S.cartesDues(opts.ids)).slice(0, Math.max(opts.n, 10));
  const totalCartes = Object.values(S.db().cartes).filter((c) => opts.ids.includes(c.coursId)).length;
  if (!paquet.length) {
    vue().innerHTML = `<div class="resultat"><h1>🃏 Rien à réviser pour l'instant</h1>
      <p>${totalCartes ? `Tes ${totalCartes} cartes sont programmées pour plus tard. Reviens demain !` : "Aucune carte n'a pu être créée : ajoute des définitions « Notion : définition » dans ton cours, ou utilise l'IA."}</p>
      <a class="btn" href="#reviser">Retour</a></div>`;
    return;
  }
  let i = 0, sues = 0;
  const afficher = () => {
    if (i >= paquet.length) {
      S.addResultat({ mode: "carte", coursIds: opts.ids, score: sues, total: paquet.length });
      vue().innerHTML = `<div class="resultat"><h1>Séance terminée 🃏</h1><p class="note">${sues} <small>/ ${paquet.length}</small></p>
        <p>Les cartes ratées reviendront demain, les cartes sues plus tard (1, 2, 4, 8 puis 16 jours).</p><a class="btn" href="#reviser">Retour</a></div>`;
      return;
    }
    const c = paquet[i];
    vue().innerHTML = `
    <div class="quiz">
      <div class="progression"><div style="width:${pct(i, paquet.length)}%"></div></div>
      <p class="muted">Carte ${i + 1} / ${paquet.length} · boîte ${c.boite}/5</p>
      <div class="flashcard" id="fc" tabindex="0"><div class="face recto">${esc(c.recto)}<small>Clique pour retourner</small></div><div class="face verso">${md(c.verso)}</div></div>
      <div class="row gap centre" id="btns" hidden>
        <button class="btn danger" data-r="0">❌ À revoir</button><button class="btn" data-r="1">✅ Je savais</button></div>
    </div>`;
    const fc = $("#fc");
    const retourner = () => { fc.classList.add("retournee"); $("#btns").hidden = false; };
    fc.onclick = retourner;
    fc.onkeydown = (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); retourner(); } };
    fc.focus();
    $$("[data-r]").forEach((b) => (b.onclick = () => { const ok = b.dataset.r === "1"; S.noterCarte(c.id, ok); if (ok) sues++; i++; afficher(); }));
  };
  afficher();
}

// =====================================================================
// Examen blanc
// =====================================================================
function pageExamen(preEpreuve, preAnnale) {
  const ia = AI.aiDisponible();
  const annales = [...S.db().annales.map((a) => ({ id: "a:" + a.id, label: `${a.titre}${a.session ? " (" + a.session + ")" : ""}` })),
    ...BANQUE.map((b) => ({ id: "b:" + b.id, label: `[${b.epreuve}] ${b.theme} — ${b.enonce.slice(0, 60)}…` }))];
  vue().innerHTML = `
  <h1>Examen blanc</h1>
  <p>Mets-toi en conditions réelles : sujet type BTS, chronomètre, copie notée sur 20.</p>
  <form id="f" class="form">
    <label>Épreuve<select name="epreuve">${EPREUVES.filter((e) => !["E2", "E32", "E42"].includes(e.id)).map((e) => `<option value="${e.id}" ${e.id === preEpreuve ? "selected" : ""}>${e.id} — ${esc(e.nom)} (${e.forme})</option>`).join("")}</select></label>
    <h2>Cours à mobiliser <small class="muted">(optionnel avec l'IA, obligatoire hors-ligne)</small></h2>
    ${selecteurCours("cours")}
    <label>Thème central (optionnel)<input name="focus" placeholder="Ex. : sinistre dégât des eaux en copropriété"></label>
    <div class="row gap">
      <label class="flex">Durée (minutes)<input type="number" name="duree" value="240" min="10" max="300"></label>
      <label class="flex">Type d'examen
        <select name="source">
          <option value="ia" ${ia ? "selected" : "disabled"}>Étude de cas rédigée par l'IA, corrigée par l'IA${ia ? "" : " — clé API requise"}</option>
          <option value="local" ${ia ? "" : "selected"}>Examen auto-corrigé (QCM, trous, vrai/faux + questions de la banque)</option>
        </select></label>
    </div>
    <label>S'inspirer d'un sujet (annale) — optionnel
      <select name="annale"><option value="">— aucun —</option>${annales.map((a) => `<option value="${a.id}" ${a.id === preAnnale ? "selected" : ""}>${esc(a.label)}</option>`).join("")}</select></label>
    <button class="btn grand">📝 Générer le sujet</button>
  </form>`;
  $("#f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const epreuve = EPREUVES.find((x) => x.id === fd.get("epreuve"));
    const ids = coches(e.target);
    const focus = fd.get("focus").trim();
    const duree = +fd.get("duree");
    const ref = fd.get("annale");
    let sujetModele = "";
    if (ref.startsWith("a:")) sujetModele = S.db().annales.find((a) => a.id === ref.slice(2))?.texte || "";
    if (ref.startsWith("b:")) { const b = BANQUE.find((x) => x.id === ref.slice(2)); sujetModele = `${b.enonce}\n(Corrigé : ${b.corrige})`; }
    if (fd.get("source") === "ia") {
      chargement("Claude rédige ton sujet d'examen…");
      try {
        const exam = await AI.genererExamen({ epreuve, texte: texteDesCours(ids, focus), focus, duree, sujetModele });
        passerExamenIA(exam, { epreuve, ids, duree, texte: texteDesCours(ids, focus) });
      } catch (err) {
        vue().innerHTML = `<div class="erreur"><p>❌ ${esc(err.message)}</p><a class="btn" href="#examen">Retour</a></div>`;
      }
    } else {
      if (!ids.length) return toast("Hors-ligne, coche au moins un cours.", "err");
      examenLocal({ epreuve, ids, focus, duree });
    }
  });
}

function chrono(minutes, el) {
  const fin = Date.now() + minutes * 60000;
  const tick = () => {
    const r = Math.max(0, fin - Date.now());
    const h = Math.floor(r / 3600000), m = Math.floor((r % 3600000) / 60000), s = Math.floor((r % 60000) / 1000);
    el.textContent = `⏱ ${h ? h + "h" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    el.classList.toggle("urgent", r < 10 * 60000);
    if (r === 0) { clearInterval(window.__chrono); el.textContent = "⏱ Temps écoulé !"; toast("Temps écoulé ! Termine ta phrase et rends ta copie.", "err"); }
  };
  clearInterval(window.__chrono);
  window.__chrono = setInterval(tick, 1000);
  tick();
}

function passerExamenIA(exam, ctx) {
  const questions = exam.dossiers.flatMap((d) => d.questions);
  const total = questions.reduce((a, q) => a + q.points, 0);
  let k = 0;
  vue().innerHTML = `
  <div class="barre-exam"><b>${esc(ctx.epreuve.id)} · ${esc(exam.titre)}</b><span id="chrono"></span></div>
  <article class="sujet">
    <h1>${esc(exam.titre)}</h1>
    <p class="muted">BTS Assurance — Épreuve ${esc(ctx.epreuve.id)} : ${esc(ctx.epreuve.nom)} · Durée : ${ctx.duree} min · Barème : ${total} points</p>
    <section><h2>Contexte</h2>${md(exam.contexte)}</section>
    ${exam.annexes.length ? `<section><h2>Annexes</h2>${exam.annexes.map((a, i) => `<details class="annexe" ${i === 0 ? "open" : ""}><summary>Annexe ${i + 1} — ${esc(a.titre)}</summary>${md(a.contenu)}</details>`).join("")}</section>` : ""}
    <form id="copie">
      ${exam.dossiers.map((d, di) => `<section><h2>Dossier ${di + 1} — ${esc(d.titre)}</h2>
        ${d.questions.map((q) => { const n = k++; return `<div class="question"><p class="enonce"><b>${n + 1}.</b> ${esc(q.enonce)} <span class="pts">(${q.points} pt${q.points > 1 ? "s" : ""})</span></p>
          <textarea name="r${n}" rows="7" placeholder="Ta réponse…"></textarea></div>`; }).join("")}</section>`).join("")}
      <div class="row gap"><button class="btn grand">📤 Rendre ma copie</button><button type="button" class="btn secondaire" onclick="window.print()">🖨 Imprimer le sujet</button></div>
    </form>
  </article>`;
  if (ctx.duree > 0) chrono(ctx.duree, $("#chrono"));
  $("#copie").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const vides = questions.filter((_, i) => !fd.get("r" + i)?.trim()).length;
    if (vides && !confirm(`${vides} question(s) sans réponse. Rendre quand même ?`)) return;
    clearInterval(window.__chrono);
    const items = questions.map((q, i) => ({ question: q.enonce, bareme: q.points, attendu: q.attendu, reponse: fd.get("r" + i) }));
    chargement("Correction de ta copie…");
    try {
      const corr = await AI.corriger(items, ctx.texte ? ctx.texte.slice(0, 200000) : "");
      const obtenu = corr.corrections.reduce((a, c) => a + c.points, 0);
      const note = sur20(obtenu, total);
      S.addResultat({ mode: "examen", epreuve: ctx.epreuve.id, coursIds: ctx.ids, score: obtenu, total, titre: exam.titre });
      vue().innerHTML = `
      <div class="resultat"><h1>Résultat — ${esc(ctx.epreuve.id)}</h1><p class="note">${note} <small>/ 20</small></p></div>
      <div class="encart">${md(corr.appreciation)}</div>
      ${items.map((it, i) => { const c = corr.corrections[i]; return `<div class="item col">
        <b>${i + 1}. ${esc(it.question)}</b>
        <span class="score-q ${c.points >= it.bareme * 0.7 ? "ok" : c.points >= it.bareme * 0.4 ? "moyen" : "ko"}">${c.points} / ${it.bareme}</span>
        <details><summary>Ma réponse</summary><p class="pre">${esc(it.reponse || "(vide)")}</p></details>
        <p>${esc(c.commentaire)}</p>
        <details><summary>Corrigé</summary>${md(c.corrige)}</details></div>`; }).join("")}
      <div class="row gap"><a class="btn" href="#examen">Nouvel examen</a><a class="btn secondaire" href="#progres">Voir ma progression</a></div>`;
    } catch (err) {
      toast(err.message, "err");
      passerExamenIA(exam, { ...ctx, duree: 0 });
      Object.entries(Object.fromEntries(fd)).forEach(([n, v]) => { const t = $(`[name="${n}"]`); if (t) t.value = v; });
    }
  });
}

function examenLocal({ epreuve, ids, focus, duree }) {
  const texte = texteDesCours(ids, focus);
  const auto = G.shuffle([...G.genQCM(texte, 8), ...G.genTrous(texte, 6), ...G.genVF(texte, 6)]);
  const banque = G.shuffle(BANQUE.filter((b) => b.epreuve === epreuve.id)).slice(0, 2);
  if (auto.length < 5) {
    vue().innerHTML = `<div class="erreur"><p>Pas assez de matière dans ces cours pour composer un examen automatique.</p><a class="btn" href="#examen">Retour</a></div>`;
    return;
  }
  vue().innerHTML = `
  <div class="barre-exam"><b>${esc(epreuve.id)} · Examen blanc auto-corrigé</b><span id="chrono"></span></div>
  <form id="copie" class="sujet">
    <h1>Examen blanc — ${esc(epreuve.nom)}</h1>
    <h2>Partie 1 — Connaissances (${auto.length} questions)</h2>
    ${auto.map((q, i) => `<div class="question" data-i="${i}"><b>${i + 1}.</b> ${htmlQuestion(q, i)}<div class="retour"></div></div>`).join("")}
    ${banque.length ? `<h2>Partie 2 — Questions rédigées</h2>${banque.map((b, j) => `<div class="question"><p class="enonce"><b>${auto.length + j + 1}.</b> ${esc(b.enonce)} <span class="pts">(${b.type})</span></p><textarea name="b${j}" rows="7"></textarea><div class="retour-b"></div></div>`).join("")}` : ""}
    <button class="btn grand">📤 Rendre ma copie</button>
  </form>`;
  chrono(Math.min(duree, 60), $("#chrono"));
  $("#copie").addEventListener("submit", (e) => {
    e.preventDefault();
    clearInterval(window.__chrono);
    const form = e.target;
    let score = 0;
    auto.forEach((q, i) => {
      const bloc = $(`.question[data-i="${i}"]`, form);
      const r = corrigerQuestion(q, i, bloc);
      score += r.score;
      $(".retour", bloc).innerHTML = `<div class="feedback ${r.score >= 0.99 ? "ok" : r.score > 0 ? "moyen" : "ko"}">${r.html}</div>`;
    });
    $$("input,textarea", form).forEach((x) => (x.disabled = true));
    form.querySelector("button.grand").remove();
    const finir = (bonus) => {
      const total = auto.length + banque.length;
      const s = score + bonus;
      S.addResultat({ mode: "examen", epreuve: epreuve.id, coursIds: ids, score: s, total });
      form.insertAdjacentHTML("afterbegin", `<div class="resultat"><p class="note">${sur20(s, total)} <small>/ 20</small></p><a class="btn" href="#examen">Nouvel examen</a></div>`);
      window.scrollTo(0, 0);
    };
    if (!banque.length) return finir(0);
    let notes = 0, faits = 0;
    $$(".retour-b", form).forEach((el, j) => {
      el.innerHTML = `<div class="feedback"><b>Corrigé :</b><p>${esc(banque[j].corrige)}</p><p>Auto-évalue-toi :</p>
        <div class="row gap">${[["1", "Complet"], ["0.5", "Partiel"], ["0", "Insuffisant"]].map(([v, l]) => `<button type="button" class="btn petit" data-v="${v}">${l}</button>`).join("")}</div></div>`;
      $$("[data-v]", el).forEach((b) => (b.onclick = () => {
        notes += +b.dataset.v; faits++;
        el.querySelector(".row").innerHTML = `<b>${b.textContent}</b>`;
        if (faits === banque.length) finir(notes);
      }));
    });
    toast("Partie 1 corrigée. Auto-évalue les questions rédigées pour obtenir ta note.");
  });
}

// =====================================================================
// Annales BTS
// =====================================================================
function pageAnnales(onglet = "banque") {
  vue().innerHTML = `
  <h1>Annales & sujets BTS Assurance</h1>
  <div class="onglets">
    ${[["banque", "📚 Banque de sujets"], ["mes", "🗂 Mes annales"], ["recherche", "🌐 Rechercher d'anciens sujets"], ["epreuves", "ℹ️ Les épreuves"]]
      .map(([id, l]) => `<a href="#annales/${id}" class="${onglet === id ? "actif" : ""}">${l}</a>`).join("")}
  </div>
  <div id="contenu-onglet"></div>`;
  ({ banque: ongletBanque, mes: ongletMesAnnales, recherche: ongletRecherche, epreuves: ongletEpreuves }[onglet] || ongletBanque)($("#contenu-onglet"));
}

function ongletEpreuves(el) {
  el.innerHTML = `<p class="muted">Organisation des épreuves du BTS Assurance (référentiel en vigueur). Vérifie les modalités de ta session (calendrier, coefficients) sur le site du SIEC.</p>
  <div class="grille">${EPREUVES.map((e) => `<div class="carte-lien statique"><b>${e.id} — ${esc(e.nom)}</b><span class="badge">${esc(e.forme)}</span><span>${esc(e.desc)}</span>
    ${e.forme.startsWith("Écrit") ? `<a class="btn petit" href="#examen/${e.id}">Examen blanc ${e.id}</a>` : ""}</div>`).join("")}</div>`;
}

function ongletBanque(el) {
  const themes = [...new Set(BANQUE.map((b) => b.theme))].sort();
  el.innerHTML = `
  <div class="info">Sujets d'entraînement rédigés d'après les thèmes qui reviennent régulièrement au BTS Assurance (ce ne sont pas des copies officielles). Pour travailler sur de vrais sujets, ajoute-les dans « Mes annales ».</div>
  <div class="row gap filtres">
    <input id="q" type="search" class="flex" placeholder="Rechercher : prescription, IRSA, bonus-malus, L113-8…">
    <select id="ep"><option value="">Toutes les épreuves</option>${[...new Set(BANQUE.map((b) => b.epreuve))].map((e) => `<option>${e}</option>`).join("")}</select>
    <select id="th"><option value="">Tous les thèmes</option>${themes.map((t) => `<option>${esc(t)}</option>`).join("")}</select>
  </div>
  <div id="res"></div>`;
  const filtrer = () => {
    const q = G.normalize($("#q").value), ep = $("#ep").value, th = $("#th").value;
    const res = BANQUE.filter((b) => (!ep || b.epreuve === ep) && (!th || b.theme === th) &&
      (!q || G.normalize(`${b.theme} ${b.enonce} ${b.corrige} ${b.motsCles.join(" ")}`).includes(q)));
    $("#res").innerHTML = `<p class="muted">${res.length} sujet(s)</p>` + res.map(carteSujet).join("");
    brancherSujets($("#res"), res);
  };
  ["input", "change"].forEach((ev) => el.addEventListener(ev, (e) => e.target.matches("#q,#ep,#th") && filtrer()));
  filtrer();
}

const carteSujet = (b) => `
  <article class="item col sujet-banque" data-id="${b.id}">
    <div class="row gap-s"><span class="badge">${b.epreuve}</span><span class="badge clair">${esc(b.theme)}</span><span class="badge clair">${esc(b.type)}</span></div>
    <p class="enonce">${esc(b.enonce)}</p>
    <details><summary>✍️ Répondre et être corrigé</summary>
      <textarea rows="6" placeholder="Ta réponse…"></textarea>
      <button class="btn petit" data-act="corriger">Corriger ma réponse</button><div class="retour"></div></details>
    <details><summary>👁 Voir les éléments de corrigé</summary><p>${esc(b.corrige)}</p></details>
    <div class="row gap-s"><a class="btn-lien" href="#examen/${b.epreuve}/b:${b.id}">📝 Examen blanc dans ce style</a>
      <a class="btn-lien" target="_blank" rel="noopener" href="${lienRecherche(b.theme)}">🌐 Chercher des annales sur ce thème</a></div>
  </article>`;

function brancherSujets(root, liste) {
  $$("[data-act=corriger]", root).forEach((btn) => (btn.onclick = async () => {
    const art = btn.closest("[data-id]");
    const b = liste.find((x) => x.id === art.dataset.id);
    const rep = $("textarea", art).value;
    const out = $(".retour", art);
    if (!rep.trim()) return toast("Écris d'abord ta réponse.", "err");
    if (!AI.aiDisponible()) {
      out.innerHTML = `<div class="feedback"><b>Éléments attendus :</b><p>${esc(b.corrige)}</p><p class="muted">Compare avec ta réponse. (Avec une clé API, l'IA corrige et note ta réponse.)</p></div>`;
      return;
    }
    btn.disabled = true;
    out.innerHTML = `<p class="muted">⏳ Correction…</p>`;
    try {
      const r = await AI.corriger([{ question: b.enonce, bareme: 4, attendu: b.corrige, reponse: rep }]);
      const c = r.corrections[0];
      out.innerHTML = `<div class="feedback ${c.points >= 3 ? "ok" : c.points >= 2 ? "moyen" : "ko"}"><b>${c.points} / 4</b><p>${esc(c.commentaire)}</p><details><summary>Corrigé</summary>${md(c.corrige)}</details></div>`;
      S.addResultat({ mode: "banque", epreuve: b.epreuve, coursIds: [], score: c.points / 4, total: 1 });
    } catch (err) { out.innerHTML = ""; toast(err.message, "err"); }
    btn.disabled = false;
  }));
}

function ongletMesAnnales(el) {
  const afficher = (q = "") => {
    const nq = G.normalize(q);
    const res = S.db().annales.filter((a) => !nq || G.normalize(`${a.titre} ${a.session} ${a.epreuve} ${a.texte}`).includes(nq))
      .sort((a, b) => (b.session || "").localeCompare(a.session || ""));
    $("#liste-annales").innerHTML = res.length ? res.map((a) => `
      <article class="item col">
        <div class="row entre"><div><h3>${esc(a.titre)}</h3><p class="muted">${esc(a.epreuve)}${a.session ? " · session " + esc(a.session) : ""}</p></div>
        <div class="actions"><a class="btn petit" href="#examen/${a.epreuve.split(" ")[0]}/a:${a.id}">📝 S'entraîner dans ce style</a><button class="btn petit danger" data-del="${a.id}">Supprimer</button></div></div>
        <details><summary>Lire le sujet</summary><div class="contenu-cours">${md(a.texte)}</div></details>
      </article>`).join("") : `<p class="vide">${S.db().annales.length ? "Aucun résultat." : "Aucune annale enregistrée. Ajoute les sujets que tu trouves (PDF du SIEC, de ton école…) pour les retrouver ici et t'entraîner dessus."}</p>`;
    $$("[data-del]").forEach((b) => (b.onclick = () => { if (confirm("Supprimer ce sujet ?")) { S.deleteAnnale(b.dataset.del); afficher($("#q").value); } }));
  };
  el.innerHTML = `
  <details class="encart" ${S.db().annales.length ? "" : "open"}><summary>➕ Ajouter un sujet d'annale</summary>
    <form id="fa" class="form">
      <div class="row gap"><label class="flex">Titre<input name="titre" required placeholder="Ex. : Cabinet Leroy — gestion d'un sinistre incendie"></label>
      <label>Session<input name="session" placeholder="2024" size="6"></label>
      <label>Épreuve<select name="epreuve">${EPREUVES.map((e) => `<option>${e.id} — ${esc(e.nom)}</option>`).join("")}</select></label></div>
      <label>Importer le PDF / Word du sujet<input type="file" id="fichier-a" accept=".pdf,.docx,.txt,.md"></label>
      <label>Texte du sujet<textarea name="texte" rows="10" required></textarea></label>
      <button class="btn">Enregistrer le sujet</button>
    </form></details>
  <input id="q" type="search" placeholder="Rechercher dans mes annales…">
  <div id="liste-annales"></div>`;
  $("#fichier-a").onchange = async (e) => {
    try { $("#fa textarea").value = await lireFichier(e.target.files[0]); toast("Sujet importé ✔", "ok"); }
    catch (err) { toast(err.message, "err"); }
  };
  $("#fa").onsubmit = (e) => {
    e.preventDefault();
    S.saveAnnale(Object.fromEntries(new FormData(e.target)));
    toast("Sujet enregistré ✔", "ok");
    pageAnnales("mes");
  };
  $("#q").oninput = (e) => afficher(e.target.value);
  afficher();
}

function ongletRecherche(el) {
  el.innerHTML = `
  <form id="fr" class="form">
    <label>Que cherches-tu ?<input name="q" required placeholder="Ex. : E41 gestion des sinistres 2023, dégât des eaux IRSI, assurance emprunteur…"></label>
    <div class="row gap">
      <button class="btn" name="ia" ${AI.aiDisponible() ? "" : "disabled title='Clé API requise'"}>🤖 Recherche IA sur le web</button>
      <button class="btn secondaire" type="button" data-moteur="google">Google (PDF)</button>
      <button class="btn secondaire" type="button" data-moteur="qwant">Qwant (PDF)</button>
    </div>
  </form>
  <div id="res-recherche"></div>
  <h2>Sources officielles et utiles</h2>
  <ul class="liens">${SOURCES_ANNALES.map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${esc(s.nom)}</a></li>`).join("")}</ul>
  <div class="info">Astuce : quand tu trouves un vrai sujet, enregistre-le dans <a href="#annales/mes">Mes annales</a> pour pouvoir le relire, le rechercher et générer des examens blancs dans le même style.</div>`;
  $$("[data-moteur]", el).forEach((b) => (b.onclick = () => {
    const q = $("#fr input").value.trim();
    if (!q) return toast("Écris d'abord ce que tu cherches.", "err");
    window.open(lienRecherche(q, b.dataset.moteur), "_blank", "noopener");
  }));
  $("#fr").onsubmit = async (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get("q");
    const out = $("#res-recherche");
    // Résultats locaux immédiats
    const nq = G.normalize(q);
    const mots = nq.split(" ").filter((w) => w.length > 2);
    const locaux = BANQUE.filter((b) => mots.some((w) => G.normalize(`${b.epreuve} ${b.theme} ${b.enonce} ${b.motsCles.join(" ")}`).includes(w))).slice(0, 5);
    out.innerHTML = `<p class="muted">⏳ Claude cherche sur le web… (30 s à 1 min)</p>
      ${locaux.length ? `<h3>Dans la banque de l'app</h3>${locaux.map(carteSujet).join("")}` : ""}`;
    brancherSujets(out, locaux);
    try {
      const r = await AI.rechercherAnnales(q);
      out.querySelector("p.muted").outerHTML = `<div class="encart">${md(r.texte)}
        ${r.sources.length ? `<h4>Pages consultées</h4><ul class="liens">${r.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.titre || s.url)}</a></li>`).join("")}</ul>` : ""}</div>`;
    } catch (err) {
      out.querySelector("p.muted").outerHTML = `<div class="erreur"><p>❌ ${esc(err.message)}</p><p class="muted">Si la recherche web n'est pas activée pour ta clé, active-la dans la console Anthropic, ou utilise les boutons Google / Qwant.</p></div>`;
    }
  };
}

// =====================================================================
// Progrès
// =====================================================================
function pageProgres() {
  const h = [...S.db().historique].sort((a, b) => b.date - a.date);
  const noms = { qcm: "QCM", trou: "Texte à trous", vf: "Vrai/Faux", ouverte: "Questions ouvertes", mixte: "Interrogation complète", carte: "Flashcards", examen: "Examen blanc", banque: "Banque de sujets" };
  const parMode = {}, parCours = {};
  for (const r of h) {
    (parMode[r.mode] ||= { s: 0, t: 0, n: 0 });
    parMode[r.mode].s += r.score; parMode[r.mode].t += r.total; parMode[r.mode].n++;
    for (const id of r.coursIds || []) {
      (parCours[id] ||= { s: 0, t: 0, n: 0 });
      parCours[id].s += r.score / (r.coursIds.length); parCours[id].t += r.total / (r.coursIds.length); parCours[id].n++;
    }
  }
  const barre = (s, t) => { const n = sur20(s, t); return `<div class="barre"><div style="width:${n * 5}%" class="${n >= 12 ? "ok" : n >= 10 ? "moyen" : "ko"}"></div><span>${n}/20</span></div>`; };
  const cartes = Object.values(S.db().cartes);
  vue().innerHTML = `
  <h1>Ma progression</h1>
  ${!h.length ? `<p class="vide">Aucune séance pour l'instant. <a href="#reviser">Lance ta première révision</a> !</p>` : `
  <div class="stats">
    <div class="stat"><span>${h.length}</span>séances</div>
    <div class="stat"><span>${sur20(h.reduce((a, r) => a + r.score, 0), h.reduce((a, r) => a + r.total, 0))}</span>moyenne /20</div>
    <div class="stat"><span>${h.filter((r) => r.mode === "examen").length}</span>examens blancs</div>
    <div class="stat"><span>${cartes.filter((c) => c.boite >= 4).length} / ${cartes.length}</span>flashcards maîtrisées</div>
  </div>
  <h2>Par mode de révision</h2>
  <table class="tableau">${Object.entries(parMode).map(([m, v]) => `<tr><td>${noms[m] || m}</td><td>${v.n} séance(s)</td><td>${barre(v.s, v.t)}</td></tr>`).join("")}</table>
  <h2>Par cours <small class="muted">(les plus faibles en premier)</small></h2>
  <table class="tableau">${Object.entries(parCours).filter(([id]) => S.getCours(id)).sort((a, b) => a[1].s / a[1].t - b[1].s / b[1].t)
    .map(([id, v]) => `<tr><td><a href="#cours/voir/${id}">${esc(S.getCours(id).titre)}</a></td><td>${v.n} séance(s)</td><td>${barre(v.s, v.t)}</td><td><a class="btn petit" href="#reviser/${id}">Réviser</a></td></tr>`).join("")}</table>
  <h2>Historique</h2>
  <table class="tableau">${h.slice(0, 40).map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${noms[r.mode] || r.mode}${r.epreuve ? " " + r.epreuve : ""}${r.focus ? ` <span class="muted">· ${esc(r.focus)}</span>` : ""}</td><td>${(r.coursIds || []).map((id) => esc(S.getCours(id)?.titre || "")).filter(Boolean).join(", ")}</td><td><b>${sur20(r.score, r.total)}/20</b></td></tr>`).join("")}</table>`}`;
}

// =====================================================================
// Réglages
// =====================================================================
function pageReglages() {
  const r = S.db().reglages;
  vue().innerHTML = `
  <h1>Réglages</h1>
  <form id="f" class="form">
    <h2>Intelligence artificielle (Claude)</h2>
    <p class="muted">Optionnel. Avec une clé API Anthropic, l'app génère des questions sur mesure, corrige tes réponses rédigées, rédige des examens blancs complets et cherche des annales sur le web.
    Crée une clé sur <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a> (service payant à l'usage). La clé est enregistrée uniquement dans ce navigateur.</p>
    <label>Clé API<input type="password" name="apiKey" value="${esc(r.apiKey)}" placeholder="sk-ant-..." autocomplete="off"></label>
    <div class="row gap">
      <label class="flex">Modèle<select name="modele">
        ${[["claude-opus-5-5", "Claude Opus 5.5 — meilleure qualité (recommandé)"], ["claude-sonnet-5-5", "Claude Sonnet 5.5 — bon équilibre, moins cher"], ["claude-haiku-5-5", "Claude Haiku 5.5 — très économique"]]
          .map(([v, l]) => `<option value="${v}" ${r.modele === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="flex">Niveau de réflexion<select name="effort">
        ${[["low", "Rapide"], ["medium", "Normal"], ["high", "Approfondi"]].map(([v, l]) => `<option value="${v}" ${r.effort === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    </div>
    <div class="row gap"><button class="btn">Enregistrer</button><button type="button" id="tester" class="btn secondaire">Tester la clé</button></div>
  </form>
  <h2>Sauvegarde de mes données</h2>
  <p class="muted">Tes cours et résultats sont stockés dans ce navigateur. Exporte-les régulièrement (et pour passer sur un autre appareil).</p>
  <div class="row gap">
    <button id="exp" class="btn secondaire">⬇️ Exporter (.json)</button>
    <label class="btn secondaire">⬆️ Importer<input type="file" id="imp" accept=".json" hidden></label>
    <button id="raz" class="btn danger">Tout effacer</button>
  </div>`;
  $("#f").onsubmit = (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    S.setReglages({ ...fd, apiKey: fd.apiKey.trim() });
    toast("Réglages enregistrés ✔", "ok");
  };
  $("#tester").onclick = async () => {
    $("#f").requestSubmit();
    try {
      toast("Test en cours…");
      const q = await AI.genererQuestions({ texte: "Prescription biennale : délai de 2 ans pour agir à compter de l'événement qui donne naissance à l'action (art. L114-1 du Code des assurances).", mode: "vf", n: 1, difficulte: "facile" });
      toast(q.length ? "✅ La clé fonctionne !" : "Réponse reçue mais vide.", "ok");
    } catch (err) { toast(err.message, "err"); }
  };
  $("#exp").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([S.exporter()], { type: "application/json" }));
    a.download = `r-vision-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  $("#imp").onchange = async (e) => {
    try {
      if (!confirm("Remplacer les données actuelles par celles du fichier ?")) return;
      S.importer(await e.target.files[0].text());
      toast("Données importées ✔", "ok");
      location.hash = "#accueil";
    } catch (err) { toast(err.message, "err"); }
  };
  $("#raz").onclick = () => {
    if (confirm("Effacer TOUS tes cours, annales et résultats ? (Pense à exporter avant.)")) {
      localStorage.removeItem("rvision-data-v1");
      location.hash = "#accueil";
      location.reload();
    }
  };
}

router();
