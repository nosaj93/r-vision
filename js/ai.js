// Fonctions IA (Claude). La clé API est saisie par l'utilisateur dans les Réglages
// et reste stockée dans son navigateur ; les appels partent directement vers l'API Anthropic.
import { db } from "./store.js";

const SDK_URL = "./vendor/anthropic-sdk.mjs"; // @anthropic-ai/sdk 0.128.0 (bundle)

const SYSTEME = `Tu es un formateur expert du BTS Assurance (référentiel français) et un correcteur d'examen.
Tu aides un(e) étudiant(e) à réviser à partir de SES cours. Règles :
- Écris en français, avec le vocabulaire technique de l'assurance (Code des assurances, Code civil, conventions IRSA/IRSI, etc.).
- Base-toi d'abord sur le contenu du cours fourni. Tu peux compléter avec tes connaissances du programme du BTS Assurance si c'est utile, en restant exact.
- Couvre l'ensemble du cours (ou la partie demandée), pas seulement le début.
- Varie les niveaux : restitution de connaissances, compréhension, application à un cas concret, calcul quand le cours s'y prête.`;

export const aiDisponible = () => !!db().reglages.apiKey;

let client = null;
let clientKey = "";
async function getClient() {
  const { apiKey } = db().reglages;
  if (!apiKey) throw new Error("Ajoute ta clé API Claude dans Réglages pour utiliser l'IA.");
  if (!client || clientKey !== apiKey) {
    const { default: Anthropic } = await import(SDK_URL);
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    clientKey = apiKey;
  }
  return client;
}

async function appel({ contenu, schema, tools, maxTokens = 32000 }) {
  const c = await getClient();
  const { modele, effort } = db().reglages;
  const params = {
    model: modele,
    max_tokens: maxTokens,
    system: SYSTEME,
    messages: [{ role: "user", content: contenu }],
    output_config: { effort, ...(schema ? { format: { type: "json_schema", schema } } : {}) },
    ...(tools ? { tools } : {}),
  };
  // Repli automatique sur un autre modèle si une réponse est refusée (non disponible sur Haiku).
  const avecRepli = !modele.startsWith("claude-haiku");
  if (avecRepli) Object.assign(params, { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });

  let msg;
  try {
    msg = await boucle(c, params);
  } catch (e) {
    if (avecRepli && e?.status === 400 && /fallback/i.test(e.message)) {
      delete params.betas;
      delete params.fallbacks;
      msg = await boucle(c, params);
    } else throw traduireErreur(e);
  }
  if (msg.stop_reason === "refusal") throw new Error("Claude a refusé cette demande. Reformule ou change de cours.");
  if (msg.stop_reason === "max_tokens") throw new Error("Réponse trop longue, interrompue. Diminue le nombre de questions.");
  const texte = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return { texte, msg };
}

// Gère les « pause_turn » (recherche web longue) en relançant la conversation.
async function boucle(c, params) {
  const p = { ...params, messages: [...params.messages] };
  for (let i = 0; i < 4; i++) {
    const msg = await c.beta.messages.stream(p).finalMessage();
    if (msg.stop_reason !== "pause_turn") return msg;
    p.messages.push({ role: "assistant", content: msg.content });
  }
  throw new Error("La recherche a pris trop de temps, réessaie.");
}

function traduireErreur(e) {
  const s = e?.status;
  if (s === 401) return new Error("Clé API invalide. Vérifie-la dans Réglages.");
  if (s === 429) return new Error("Trop de requêtes : attends un peu et réessaie.");
  if (s === 529 || s >= 500) return new Error("Le service Claude est surchargé, réessaie dans un instant.");
  if (!s && /fetch|network/i.test(e?.message || "")) return new Error("Pas de connexion internet (l'IA nécessite d'être en ligne).");
  return new Error(e?.message || String(e));
}

const parseJSON = (t) => JSON.parse(t.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));

// ---------- Génération de questions ----------

const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["qcm", "trou", "vf", "ouverte", "carte"] },
          question: { type: "string" },
          choix: { type: "array", items: { type: "string" } },
          bonne: { type: "integer" },
          texte: { type: "string" },
          reponses: { type: "array", items: { type: "string" } },
          affirmation: { type: "string" },
          vrai: { type: "boolean" },
          reponse: { type: "string" },
          recto: { type: "string" },
          verso: { type: "string" },
          explication: { type: "string" },
        },
        required: ["type", "explication"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const CONSIGNES = {
  qcm: `QCM : type "qcm", "question", "choix" (4 propositions plausibles, une seule juste), "bonne" (index 0-3 de la bonne réponse), "explication".`,
  trou: `Texte à trous : type "trou", "texte" = une ou deux phrases du cours où chaque mot ou groupe de mots clé retiré est remplacé par {{0}}, {{1}}…, "reponses" = les mots retirés dans l'ordre (courts : 1 à 4 mots), "explication" = phrase complète.`,
  vf: `Vrai/Faux : type "vf", "affirmation", "vrai" (booléen), "explication" qui justifie (et corrige si faux). Environ moitié vraies, moitié fausses, avec des pièges réalistes (délais, articles, montants, conditions).`,
  ouverte: `Question ouverte : type "ouverte", "question" (définition, explication, cas pratique court ou calcul), "reponse" = corrigé modèle complet attendu au BTS, "explication" = critères de réussite.`,
  carte: `Flashcard : type "carte", "recto" (notion, question courte), "verso" (réponse concise à mémoriser), "explication" (moyen mnémotechnique ou exemple).`,
};

export async function genererQuestions({ texte, focus, mode, n, difficulte }) {
  const types = mode === "mixte" ? ["qcm", "trou", "vf", "ouverte"] : [mode];
  const contenu = `Voici mon cours :
<cours>
${texte}
</cours>

${focus ? `Je veux travailler en priorité sur : « ${focus} ».` : "Interroge-moi sur l'ensemble du cours, en répartissant les questions sur toutes les parties."}
Niveau de difficulté : ${difficulte}.
Génère exactement ${n} questions ${mode === "mixte" ? "en mélangeant les formats ci-dessous" : "au format suivant"} :
${types.map((t) => "- " + CONSIGNES[t]).join("\n")}
Ne mets que les champs utiles au format choisi.`;
  const { texte: t } = await appel({ contenu, schema: QUESTION_SCHEMA });
  return parseJSON(t).questions.filter(valide);
}

function valide(q) {
  switch (q.type) {
    case "qcm": return q.question && Array.isArray(q.choix) && q.choix.length >= 2 && q.bonne >= 0 && q.bonne < q.choix.length;
    case "trou": return q.texte && Array.isArray(q.reponses) && q.reponses.length > 0 && q.texte.includes("{{0}}");
    case "vf": return q.affirmation && typeof q.vrai === "boolean";
    case "ouverte": return !!q.question;
    case "carte": return q.recto && q.verso;
    default: return false;
  }
}

// ---------- Correction de réponses rédigées ----------

const CORRECTION_SCHEMA = {
  type: "object",
  properties: {
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          points: { type: "number" },
          commentaire: { type: "string" },
          corrige: { type: "string" },
        },
        required: ["points", "commentaire", "corrige"],
        additionalProperties: false,
      },
    },
    appreciation: { type: "string" },
  },
  required: ["corrections", "appreciation"],
  additionalProperties: false,
};

// items : [{ question, bareme, attendu?, reponse }]
export async function corriger(items, texteCours = "") {
  const contenu = `${texteCours ? `Cours de référence :\n<cours>\n${texteCours}\n</cours>\n\n` : ""}Corrige mes réponses comme un correcteur du BTS Assurance (bienveillant mais exigeant).
Pour chaque question : "points" obtenus (entre 0 et le barème, demi-points autorisés), "commentaire" (ce qui est juste, ce qui manque, erreurs), "corrige" (réponse modèle attendue).
Puis une "appreciation" générale avec 2-3 conseils de révision.

${items.map((it, i) => `### Question ${i + 1} (barème : ${it.bareme} pt)
${it.question}
${it.attendu ? `Éléments attendus : ${it.attendu}\n` : ""}Ma réponse : ${it.reponse?.trim() || "(pas de réponse)"}`).join("\n\n")}`;
  const { texte } = await appel({ contenu, schema: CORRECTION_SCHEMA });
  const r = parseJSON(texte);
  r.corrections = r.corrections.map((c, i) => ({ ...c, points: Math.max(0, Math.min(items[i]?.bareme ?? 1, c.points)) }));
  return r;
}

// ---------- Examen blanc ----------

const EXAMEN_SCHEMA = {
  type: "object",
  properties: {
    titre: { type: "string" },
    contexte: { type: "string" },
    annexes: {
      type: "array",
      items: {
        type: "object",
        properties: { titre: { type: "string" }, contenu: { type: "string" } },
        required: ["titre", "contenu"],
        additionalProperties: false,
      },
    },
    dossiers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titre: { type: "string" },
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                enonce: { type: "string" },
                points: { type: "number" },
                attendu: { type: "string" },
              },
              required: ["enonce", "points", "attendu"],
              additionalProperties: false,
            },
          },
        },
        required: ["titre", "questions"],
        additionalProperties: false,
      },
    },
  },
  required: ["titre", "contexte", "annexes", "dossiers"],
  additionalProperties: false,
};

export async function genererExamen({ epreuve, texte, focus, duree, sujetModele }) {
  const contenu = `Rédige un sujet d'examen blanc type BTS Assurance pour l'épreuve ${epreuve.id} « ${epreuve.nom} » (${epreuve.forme}). ${epreuve.desc}
Durée prévue : ${duree} minutes. Le barème total doit faire exactement 20 points.
Format attendu (comme au BTS) : une étude de cas avec une entreprise d'assurance ou un cabinet fictif, un "contexte" détaillé, des "annexes" (documents : extraits de contrat, conditions générales, constat, tableau de garanties, courrier client, articles de loi…) et 2 à 4 "dossiers" de questions progressives. Pour chaque question : "enonce", "points", "attendu" (éléments de corrigé précis pour le correcteur).
${focus ? `Centre le sujet sur : « ${focus} ».` : ""}
${texte ? `Le sujet doit porter sur les notions de mes cours :\n<cours>\n${texte}\n</cours>` : "Appuie-toi sur le programme officiel de cette épreuve."}
${sujetModele ? `\nInspire-toi du style, du niveau et de la structure de ce sujet d'annale (sans le recopier) :\n<annale>\n${sujetModele}\n</annale>` : ""}`;
  const { texte: t } = await appel({ contenu, schema: EXAMEN_SCHEMA, maxTokens: 64000 });
  return parseJSON(t);
}

// ---------- Recherche d'anciens sujets sur le web ----------

export async function rechercherAnnales(requete) {
  const { modele } = db().reglages;
  const type = modele.startsWith("claude-haiku") ? "web_search_20250305" : "web_search_20260209";
  const contenu = `Recherche sur le web d'anciens sujets d'examen (annales) du BTS Assurance correspondant à : « ${requete} ».
Cherche en priorité sur les sites officiels (siec.education.fr, académies, eduscol, CRCF/CERPEG) puis sur les sites de ressources pédagogiques.
Réponds avec :
1. Une liste des sujets trouvés : session (année), épreuve, thème principal, lien. N'invente aucun lien : ne donne que des URLs réellement trouvées.
2. Les thèmes et types de questions qui reviennent le plus souvent sur ce sujet au BTS.
3. 3 conseils pour s'entraîner.
Mets en forme avec des titres (##) et des listes (-).`;
  const { msg } = await appel({ contenu, tools: [{ type, name: "web_search", max_uses: 6 }], maxTokens: 16000 });
  const texte = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const sources = [];
  for (const b of msg.content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content))
      for (const r of b.content) if (r.url && !sources.some((s) => s.url === r.url)) sources.push({ titre: r.title, url: r.url });
  }
  return { texte, sources };
}
