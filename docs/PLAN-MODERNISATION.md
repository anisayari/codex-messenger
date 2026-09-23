# Plan de modernisation Codex Messenger

Établi le 22 septembre 2026. Projet actuel : 0.0.2-9 ; minimum Codex déclaré : 0.125.0. CLI local observé : 0.154.0. Cible initiale vérifiée : 0.155.1. La version stable 0.156.0, publiée pendant le chantier, devient la cible finale après une nouvelle vérification npm/GitHub et comparaison des schémas.

## Résultat attendu

Un client Electron rétro fonctionnel du serveur Codex local, respectant les capacités et les politiques effectives du serveur. Toute fonction visible doit appeler un service réel ou être explicitement présentée comme locale. Les services du bureau Codex non exposés publiquement et les anciens services MSN fermés ne peuvent pas être reconstitués en inventant des réponses.

## Ordre d'exécution

1. **Sources et inventaire** : archiver tous les changelogs stables de 0.125.0 à la version stable courante avec dates, URLs, empreintes et méthode ; inventorier les API, les ressources MSN 7.5 et les parcours existants.
2. **Audit** : relever les défauts reproductibles de protocole, sauvegarde, mises à jour, sécurité Electron, streaming, invitations, audio, activités et accessibilité ; classer par impact.
3. **Socle Codex** : protocole généré par la version cible, cycle de vie et erreurs JSON-RPC, encodage UTF-8, pagination, restauration des connecteurs configurés, modèles et efforts découverts auprès du serveur.
4. **Interactions modernes** : questions et demandes d'autorisation, permissions, formulaires/URL MCP, annulation et expiration ; fournir un retour visible et éviter les blocages de tour.
5. **Fonctions accessibles** : modes de collaboration, objectifs, historique, fork, archive/restauration, noms/épinglage, skills, compte/quotas, connexions MCP/apps et outils du serveur selon capacités vérifiées.
6. **Fidélité Messenger** : conserver les ressources authentiques avec leur provenance, fiabiliser émoticônes, sons, wizz, fenêtres, profils, arrière-plans, transferts et saisie ; supprimer les fausses affirmations d'appel, de collaboration ou de jeu avec Codex.
7. **Validation** : tests unitaires ciblés et contrat réel de 0.156.0, sécurité/dépendances, métadonnées de distribution, build, smoke Electron, interactions dans les fenêtres et erreurs. Conserver une matrice des fonctions et de leurs preuves, en distinguant simulation du protocole, service réel et matériel non testé.

## Premiers défauts confirmés

- Le client désactive MCP, apps et plugins sauf variable d'environnement ; cela masque des capacités du Codex configuré.
- Les demandes du serveur autres que les anciennes approbations commandes/fichiers sont rejetées.
- Les efforts de raisonnement sont filtrés par une ancienne liste fixe (jusqu'à xhigh).
- Les tests de contrat utilisent notamment un serveur écrit à la main : ils ne prouvent pas seuls la compatibilité avec la version courante.
- Les jeux locaux et les invites textuelles peuvent donner une impression trompeuse de coopération avec Codex.

Les audits détaillés et la matrice de migration complètent ce plan. Les fonctions réservées à un produit, un compte, une politique ou un périphérique seront indiquées avec leur condition réelle et leur niveau de validation.

## Sources initiales

- https://learn.chatgpt.com/docs/changelog
- https://developers.openai.com/codex/app-server
- https://registry.npmjs.org/@openai/codex/latest

## Exécution réalisée

- Archive de 50 releases stables de 0.125.0 à 0.156.0 ; schémas standard et expérimentaux générés par les binaires officiels et comparés.
- Correctifs et fonctionnalités publiques détaillés dans CODEX-MIGRATION.md, CODEX-0.156.0-DELTA.md et les audits backend/UI.
- Restauration des assets MSN attestés : 79 icônes classiques, 69 raccourcis officiels, sons et 15 clins d’œil originaux relus localement.
- Tests de protocole et parcours du renderer, inférence réelle isolée, Electron natif, terminal et préférence vocale réelle. Les résultats finaux et limites matérielles figurent dans VALIDATION.md.

## Publication demandée le 23 septembre 2026

Publier Messenger v0.0.3 et le site existant par GitHub Actions, avec Codex0.156.1 et son hotfix de catalogue (51 releases archivées). Anglais à toute arrivée sur la page racine du site ; français choisi explicitement par URL/sélecteur. Contrôler les applications empaquetées Windowsx64/macOSarm64/macOSx64, leurs empreintes et le site en production avant clôture. Voir PUBLICATION-0.0.3.md pour les résultats de cette nouvelle étape.
