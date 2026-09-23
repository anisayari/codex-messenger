# Audit initial de l’interface et des fonctions MSN

État inspecté le 22 septembre 2026, avant les corrections. Cette liste distingue les comportements observés dans le code des fonctions historiques et des limites du runtime Codex. Les numéros de ligne ci-dessous décrivent cet état initial.

## Défauts à corriger en premier

| Priorité | Preuve | Conséquence | Correction attendue |
| --- | --- | --- | --- |
| P1 | `src/main.jsx:2079–2101`, Enter appelle `submit` sans `isComposing` | Une validation de saisie IME peut envoyer prématurément un message. | Respecter la composition et vérifier Enter, Shift+Enter et les commandes. |
| P1 | `src/main.jsx:1929–1952`, `1979–2000` | Le brouillon disparaît avant la réponse IPC; un résultat `{ok:false}` n’est pas traité comme une erreur. | Conserver un message récupérable et les pièces jointes après échec; bloquer les envois multiples en attente. |
| P1 | `src/main.jsx:1989–1996` | Plusieurs images sont envoyées au runtime mais seule la première figure dans le message local. | Afficher et ouvrir toutes les pièces jointes envoyées. |
| P1 | `src/mediaPanels.jsx:50–61` | « Inviter » envoie une demande de fiction au modèle; aucune invitation ni session collective n’est créée. | Présenter la limite et proposer les opérations réelles sur les conversations. |
| P1 | `src/gamesPanel.jsx:46–87`, `199–255` | Un algorithme local et des minuteries sont présentés comme Codex; Memory et Wizz Reflex ne sont pas justifiés comme jeux MSN historiques. | Garder seulement un jeu attesté et identifier honnêtement les joueurs locaux. |
| P1 | `src/main.jsx:2360–2390` | L’audio n’est transmis qu’en chemin texte et on demande une transcription non garantie; l’enregistrement est illimité. | Clip local plafonné, lisible et ouvrable, et capacités vocales du runtime explicitement vérifiées. |
| P2 | `src/main.jsx:2316–2324` | « Fichier envoyé » décrit un chemin local, sans mécanisme de transfert; le fichier texte n’est pas ouvrable dans le message. | Préparer la pièce jointe dans le brouillon, expliquer l’accès local et permettre son ouverture. |
| P2 | `src/composer.jsx:69`, `src/mediaPanels.jsx:32–35` | Zone de message sans nom accessible; boutons à icône sans texte ni nom explicite. | Noms accessibles, états des boutons, focus visible. |
| P2 | `src/styles.css` | Aucune règle `prefers-reduced-motion`; clins d’œil et indicateurs continuent à animer. | Réduire les animations pour la préférence système. |
| P2 | `src/main.jsx:1734–1742` | La fermeture/modification d’un flux caméra arrête aussi le micro, par le nettoyage d’un effet dépendant de la caméra. | Séparer les cycles de vie et nettoyer tous les flux/minuteries à la fermeture. |
| P2 | `src/main.jsx:2266–2274` | La recherche indique seulement le nom de l’auteur; elle ne révèle ni résultat ni emplacement. | Afficher les résultats et amener le message trouvé dans la zone visible. |
| P2 | `public/msn-assets/msn75/manifest.json` | Le manifeste principal annonce 345 exports d’émoticônes; le manifeste spécifique recense 42 fichiers actifs. | Vérifier l’intégrité et différencier les ressources originales des exports utilisables. |

## Inventaire constaté

Le dossier `public/msn-assets` contient 1 185 fichiers, 8 488 730 octets, dont 494 PNG, 15 GIF, 8 JPG, 13 WAV et 15 SWF. Le manifeste principal déclare 969 ressources extraites de MSN Messenger 7.5.0322. Le manifeste de paquets contient 68 fichiers pour les clins d’œil, les arrière-plans dynamiques et MSN Search. Il s’agit de provenance déclarée dans le dépôt, pas d’une autorisation de redistribution vérifiée.

Les 15 clins d’œil officiels ont une miniature PNG/JPG et un fichier SWF. L’interface actuelle affiche la miniature avec une animation CSS: elle ne joue pas l’animation Flash originale. Les quatre arrière-plans dynamiques sont conservés en paquets `inner.mct`, mais ne sont exposés par aucun réglage de conversation. Les fichiers d’origine sont préservés; ils ne doivent pas être exécutés comme programmes.

## Correspondance historique et limites

| Fonction Messenger attestée | État du client | Adaptation honnête |
| --- | --- | --- |
| Contacts, groupes, états et message personnel | Présents pour profils, projets et conversations | Conserver les groupes et la présentation; l’état décoratif ne doit pas masquer l’activité réelle du runtime. |
| Images de profil | Images originales et import local présents | Conserver et vérifier les chemins. |
| Police/couleur, émoticônes, historique enregistré | Présents; réglages limités et export texte | Améliorer la lisibilité, la sélection des résultats et l’accès clavier. |
| Arrière-plans personnalisés | Ressources présentes, sélecteur absent | Ajouter les images originales décodables et signaler les contenus dynamiques non pris en charge. |
| Jeux MSN, dont Tic Tac Toe | Morpion présent, faux adversaire Codex | Morpion local avec joueurs nommés; ne pas simuler une connexion réseau MSN. |
| Wizz/Nudge | Son et secousse natifs présents | Signal d’attention local; tenir compte des préférences de mouvement. |
| Clins d’œil | Miniatures présentes | Identifier les aperçus; ne pas revendiquer une lecture originale SWF. |
| Webcam, voix, partage de fichiers | Capture locale/photo et chemin de fichier présents | Image réellement transmise à Codex; audio et fichiers ouverts/accessibles localement avec leur statut réel. |
| Conversation MSN à plusieurs | Aucun transport MSN | Ne pas inventer des contacts participants; utiliser uniquement les fonctions de fils/agents réellement disponibles dans Codex. |
| MSN Spaces, Hotmail, téléphone, réseau MSN et achats de packs | Aucun service correspondant | Ne pas fabriquer une intégration. Les sons/ressources historiques peuvent rester des aperçus locaux. |

## Sources vérifiées

- [Microsoft, lancement MSN Messenger 6, 18 juin 2003](https://news.microsoft.com/source/2003/06/18/msn-messenger-6-allows-im-lovers-to-express-themselves-with-style/): images de profil, arrière-plans personnalisés, polices/couleurs, journal des messages, webcam et jeux dont Tic Tac Toe.
- [Microsoft, MSN Instant Games, 23 avril 2004](https://news.microsoft.com/source/2004/04/23/more-playful-every-day-msns-got-game-with-msn-messenger/): jeux en conversation et invitations à des contacts. Ce service historique n’est pas un backend du client.
- [Microsoft, lancement MSN Messenger 7.0, 7 avril 2005](https://news.microsoft.com/source/2005/04/07/global-availability-of-msn-messenger-and-msn-spaces-connects-people-around-the-world/): voix, vidéo et personnalisation, liens MSN Spaces/Search.
- Les manifestes `public/msn-assets/msn75/manifest.json`, `emoticons/manifest.json`, `packages/manifest.json` et les XML des paquets sont les preuves locales des ressources 7.5 disponibles.
- [Liste 7.5 citant la responsable du programme MSN, 29 août 2005](https://kurtsh.com/2005/08/29/info-msn-messenger-7-5-whats-new-list/): source de seconde main, utilisée seulement comme piste historique pour le clip de 15 secondes/F2 et les arrière-plans dynamiques, pas comme documentation actuelle du runtime.

## Validation proportionnée

Tester les décisions du compositeur (IME, Enter/Shift+Enter, pièces jointes), l’intégrité des ressources réellement référencées et les scénarios rendus: chargement Electron, noms accessibles, échec d’envoi sans perte, galerie, jeu local et arrière-plan. Un build seul ne prouve ni une voix native ni une collaboration Codex effective.
