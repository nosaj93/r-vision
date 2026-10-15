# R-Vision : révisions BTS Assurance

Application web pour **ranger tes cours** et **réviser le BTS Assurance** de plusieurs façons.
Pas d'installation ni de compte : tout fonctionne dans le navigateur et tes données restent sur ton appareil.

## Fonctionnalités

| Partie | Ce que tu peux faire |
|---|---|
| **Mes cours** | **Import de tous tes fichiers d'un coup** (sélection multiple, glisser-déposer ou dossier entier) : chaque fichier devient un cours, la matière est devinée d'après le nom du fichier. Formats : **PDF**, **Word (.docx)**, .txt, .md. Ajout, modification et recherche, repérage automatique des définitions. |
| **Réviser** | Choisir un ou plusieurs cours et éventuellement **un thème précis**, puis : **QCM**, **texte à trous**, **vrai/faux**, **questions ouvertes** (corrigées), **interrogation complète** (tous formats mélangés), **flashcards** (répétition espacée, méthode de Leitner). |
| **Examen blanc** | Sujet type BTS (E1, E31, E41, E5, E6) chronométré, avec contexte, annexes et dossiers, noté sur 20 et corrigé question par question. Possibilité de s'inspirer d'une annale. |
| **Annales BTS** | Présentation des épreuves, **banque de sujets d'entraînement** filtrable (épreuve, thème, mot-clé) avec éléments de corrigé, **« Mes annales »** pour stocker les vrais sujets que tu trouves, **recherche d'anciens sujets** (IA sur le web, Google/Qwant en PDF, sources officielles). |
| **Progrès** | Moyenne /20, résultats par mode et par cours (les plus faibles d'abord), historique. |

## Deux façons de générer les questions

1. **Sans IA (gratuit, hors-ligne)** : les questions sont fabriquées automatiquement à partir du texte de tes cours.
   Pour de meilleurs résultats, écris tes définitions sous la forme `Notion : définition`.
2. **Avec l'IA Claude (recommandé)** : ajoute ta clé API Anthropic dans **Réglages** ([console.anthropic.com](https://console.anthropic.com/), payant à l'usage).
   L'IA rédige des questions sur tout le cours ou sur la partie choisie, **corrige tes réponses rédigées**, crée des **études de cas type BTS** notées sur 20 et **cherche des annales sur le web**.
   La clé reste enregistrée dans ton navigateur et n'est envoyée qu'à l'API d'Anthropic.

## Lancer l'application

- **En local** : dans le dossier du projet, lance `python3 -m http.server 8000` puis ouvre <http://localhost:8000>.
  (Ouvrir directement `index.html` en double-cliquant ne fonctionne pas, à cause des modules JavaScript.)
- **En ligne (gratuit)** : sur GitHub, va dans *Settings → Pages*, choisis la branche et le dossier `/ (root)`. L'app sera disponible à l'adresse `https://<ton-pseudo>.github.io/r-vision/`.

## Sauvegarde

Les données sont stockées dans le navigateur (localStorage). Pense à **exporter une sauvegarde** depuis *Réglages*, surtout avant de changer d'appareil ou de vider le cache.

## À savoir

- La banque de sujets contient des **sujets d'entraînement rédigés d'après les thèmes récurrents** du BTS Assurance. Ce ne sont pas des copies d'annales officielles. Les vrais sujets se trouvent notamment sur le site du [SIEC](https://siec.education.fr/candidats/docutheque).
- Vérifie toujours les modalités de ta session (épreuves, durées, coefficients) dans les textes officiels.

## Structure du code

```
index.html          page unique
css/style.css       styles (thème clair/sombre automatique)
js/app.js           interface et pages
js/store.js         stockage local (cours, annales, résultats, flashcards)
js/generators.js    génération de questions sans IA
js/ai.js            appels à l'API Claude
js/bts-data.js      épreuves, banque de sujets, sources
js/vendor/          bibliothèques embarquées (SDK Anthropic, pdf.js, mammoth)
```
