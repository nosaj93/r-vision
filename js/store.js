// Stockage local (navigateur). Tout reste sur l'appareil de l'utilisateur.

const KEY = "rvision-data-v1";

const defaults = () => ({
  cours: [],        // { id, titre, matiere, chapitre, contenu, cree, modifie }
  annales: [],      // sujets ajoutés par l'utilisateur : { id, titre, session, epreuve, texte, cree }
  historique: [],   // { id, date, mode, coursIds, score, total, detail }
  cartes: {},       // flashcards Leitner : { [id]: { coursId, recto, verso, boite, prochaine } }
  reglages: { apiKey: "", modele: "claude-opus-5-5", effort: "medium" },
});

let data = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    return { ...defaults(), ...JSON.parse(raw) };
  } catch {
    return defaults();
  }
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    alert("Impossible d'enregistrer (stockage plein ?). Exporte une sauvegarde.\n" + e.message);
  }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const db = () => data;

// ---------- Cours ----------
export function listCours() {
  return [...data.cours].sort((a, b) => b.modifie - a.modifie);
}
export const getCours = (id) => data.cours.find((c) => c.id === id);
export function saveCours(c) {
  const now = Date.now();
  if (c.id) {
    const i = data.cours.findIndex((x) => x.id === c.id);
    data.cours[i] = { ...data.cours[i], ...c, modifie: now };
  } else {
    c = { ...c, id: uid(), cree: now, modifie: now };
    data.cours.push(c);
  }
  save();
  return c;
}
export function deleteCours(id) {
  data.cours = data.cours.filter((c) => c.id !== id);
  for (const [k, v] of Object.entries(data.cartes)) if (v.coursId === id) delete data.cartes[k];
  save();
}

// ---------- Annales perso ----------
export function saveAnnale(a) {
  if (a.id) {
    const i = data.annales.findIndex((x) => x.id === a.id);
    data.annales[i] = { ...data.annales[i], ...a };
  } else data.annales.push({ ...a, id: uid(), cree: Date.now() });
  save();
}
export function deleteAnnale(id) {
  data.annales = data.annales.filter((a) => a.id !== id);
  save();
}

// ---------- Historique ----------
export function addResultat(r) {
  data.historique.push({ ...r, id: uid(), date: Date.now() });
  save();
}

// ---------- Flashcards (système de Leitner, 5 boîtes) ----------
const INTERVALLES = [0, 1, 2, 4, 8, 16]; // jours selon la boîte
export function upsertCartes(coursId, cartes) {
  for (const c of cartes) {
    const id = coursId + ":" + c.recto.slice(0, 60);
    if (!data.cartes[id]) data.cartes[id] = { coursId, recto: c.recto, verso: c.verso, boite: 1, prochaine: 0 };
  }
  save();
}
export function cartesDues(coursIds) {
  const now = Date.now();
  return Object.entries(data.cartes)
    .filter(([, c]) => coursIds.includes(c.coursId) && c.prochaine <= now)
    .map(([id, c]) => ({ id, ...c }));
}
export function noterCarte(id, reussi) {
  const c = data.cartes[id];
  if (!c) return;
  c.boite = reussi ? Math.min(5, c.boite + 1) : 1;
  c.prochaine = Date.now() + INTERVALLES[c.boite] * 86400000;
  save();
}

// ---------- Réglages ----------
export function setReglages(r) {
  data.reglages = { ...data.reglages, ...r };
  save();
}

// ---------- Sauvegarde ----------
export function exporter() {
  const copie = { ...data, reglages: { ...data.reglages, apiKey: "" } };
  return JSON.stringify(copie, null, 2);
}
export function importer(json) {
  const obj = JSON.parse(json);
  if (!Array.isArray(obj.cours)) throw new Error("Fichier de sauvegarde invalide");
  const apiKey = data.reglages.apiKey;
  data = { ...defaults(), ...obj };
  data.reglages.apiKey = data.reglages.apiKey || apiKey;
  save();
}
