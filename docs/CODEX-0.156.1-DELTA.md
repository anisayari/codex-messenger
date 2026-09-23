# Delta Codex 0.156.0 → 0.156.1

Vérifié le **23 septembre 2026 à 14:17–14:21 UTC**. La dernière version stable publique est **0.156.1**, confirmée indépendamment par [npm latest](https://registry.npmjs.org/@openai%2fcodex/latest) et [GitHub latest](https://api.github.com/repos/openai/codex/releases/latest). GitHub publie le hotfix à **02:41:36 UTC** ; npm à **02:45:25.210 UTC**. L’archive passe de 50 à **51 releases stables**, de 0.125.0 à 0.156.1, sans autre version stable ajoutée dans cet intervalle.

## Changement officiel

Les [notes de release](https://github.com/openai/codex/releases/tag/rust-v0.156.1) ajoutent GPT-6 Sol et GPT-6 Luna au catalogue de modèles et font recommander Luna par le prompt TUI lors d’un changement après limite. La [comparaison des tags](https://github.com/openai/codex/compare/rust-v0.156.0...rust-v0.156.1) contient le hotfix du catalogue, le numéro de version et les ajustements TUI/tests correspondants. Le statut GitHub est « diverged » (2 commits en avance, 1 en arrière) : cette publication est une branche de hotfix ; elle n’est pas présentée comme un simple fast-forward de main.

Pour Messenger, la liste des modèles et les efforts doivent continuer à venir de `model/list`. Le catalogue dynamique peut afficher ces modèles lorsqu’ils sont renvoyés par le CLI pour le compte/provider courant. Aucun modèle ni effort n’est imposé dans la configuration du projet. Le prompt propre au TUI ne devient pas une fonction MSN inventée ni une bascule automatique dans Messenger.

## Compatibilité app-server

Les paquets wrapper et darwin-arm64 officiels des versions 0.156.0 et 0.156.1 ont été téléchargés en isolation et validés avec les **SHA512/SHA1 npm**, puis les deux binaires Rust ont généré leurs schémas standard et expérimentaux. Vérification directe `Buffer.equals` : **746/746 JSON identiques**, soit **7 769 779 octets comparés**, descriptions et titres compris.

| Contrat | JSON | Méthodes client | Demandes serveur | Notifications |
|---|---:|---:|---:|---:|
| Standard | 310 | 101 | 10 | 82 |
| Expérimental | 436 | 164 | 11 | 82 |

Aucune route, propriété, union, contrainte ou valeur enum du contrat app-server ne change. Les services, la timeline et le courtier de demandes n’ont pas besoin d’adaptation de contrat pour ce hotfix. Le retrait de `thread/rollback` effectué en 0.156.0 reste effectif ; cette méthode n’est pas réintroduite. Les disponibilités dépendant du compte ou du produit hôte ne sont pas garanties par l’existence d’un schéma.

Preuves permanentes : [comparaison complète](codex-changelog/protocol-compatibility-0.156.0--0.156.1.json), [intégrité npm](codex-changelog/cli-integrity-0.156.0--0.156.1.json), [méthodes 0.156.1](codex-changelog/protocol-methods-0.156.1.json). SHA256 du Rust darwin-arm64 0.156.1 : `0196e89fe5a7598f816ee54232c3d7c26d75e502ab5cfe2c9240e81d90f7255a`.

La comparaison de contrat est réalisée sans inférence et ne modifie aucun compte/configuration utilisateur. Le plancher de compatibilité, la documentation d’installation et les contrôles de release sont actualisés par la tâche de publication séparée.

## Validation réelle 0.156.1

La tâche de publication a ensuite activé séparément les **trois fixtures réelles sur le Rust 0.156.1**, avec Node v24.19.0 et le client final `7c74d05a…` : **3 tests réussis, aucun échec et aucun skip**. Une seule génération bénigne `CODEX-MSN-OK` vérifie 6 deltas, un tour conservé après arrêt/redémarrage du serveur, recherche du thread isolé, 2 occurrences avec plages UTF-16 exactes, reprise et fork. Le test de métadonnées vérifie la vraie réponse `-32600` avant matérialisation d’un nouveau thread. Le catalogue et le vrai PTY réussissent ; usage/limites indisponibles sans compte restent explicitement signalés.

Les profils privés et processus app-server sont nettoyés (**0 restant**). Preuve datée et journaux : [live-validation-0.156.1.json](validation/live-validation-0.156.1.json), SHA256 `175bcd19aaf345f18605e23b4a5187d9464f499034548c8709a676e44473275b`. Le microphone physique n’a pas été testé par ces fixtures. Les preuves comportementales [0.156.0](CODEX-0.156.0-DELTA.md) demeurent historiques ; la réussite 0.156.1 provient de ces nouvelles exécutions.

## Release publique Messenger avant publication

Lecture API du 23 septembre à **14:17 UTC** : la dernière release publique [Codex Messenger v0.0.2.9](https://github.com/anisayari/codex-messenger/releases/tag/v0.0.2.9), datée du **25 avril 2026 à 13:46:40 UTC**, contient **7 assets uploaded** : DMG et ZIP macOS arm64, leurs deux blockmaps, portable et installateur Windows, et blockmap de l’installateur. L’API fournit leurs SHA256 ; les binaires Messenger ne sont pas téléchargés ni recalculés dans cet audit. Cette release ne comporte aucun asset Linux. Ce constat est un snapshot antérieur à la nouvelle publication autorisée.
