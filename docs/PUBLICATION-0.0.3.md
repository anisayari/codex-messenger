# Publication Messenger v0.0.3

Cible vérifiée le 23 septembre 2026 : Codex CLI **0.156.1**, dernière stable concordante dans npm et GitHub, avec **51 changelogs** archivés et vérifiés. Le CLI reste une installation locale séparée ; sa détection réelle sélectionne le binaire npm natif 0.156.1.

## Contrôles avant publication

| Contrôle | Résultat vérifié |
|---|---|
| Suite par défaut, Node 24.19 | **259 tests : 256 réussis, 3 opt-in ignorés, 0 échec ou annulation**, 2,75 s ; découverte portable explicite |
| Preuve native CLI pour la distribution | **Réussie localement** : Rust npm 0.156.1 ARM, version et Mach-O vérifiés, empreinte SHA256, contrat non authentifié 1/1 réussi ; requise sur chacun des trois runners |
| Trois fixtures CLI 0.156.1 | **3/3 réussies**, aucune ignorée : message bénin en 6 deltas, historique après redémarrage, reprise, fork, recherche et deux occurrences UTF-16 ; métadonnées, catalogue et PTY |
| Audit npm | **0 vulnérabilité**, 513 dépendances comptabilisées |
| Preflight distribution | **Réussi pour 0.0.3 / v0.0.3**, minimum CLI 0.156.1 et versions package/lock cohérentes |
| Build Vite et .app locale ARM | **Réussi** ; Electron 41.10.7, application empaquetée dans app.asar |
| Smoke de cette .app | **Réussi** : 14 contrôles de démarrage, preload, IPC, version et isolation ; zéro erreur, fermeture avec code 0 |
| Assets | **1 294/1 294 copiés et vérifiés**, 269/269 empreintes de référence exactes ; 79 icônes, 69 raccourcis, 15 clins d’œil et les huit fichiers Ruffle |
| Contrat CLI 0.156.0 → 0.156.1 | **746/746 JSON identiques octet par octet** ; catalogue dynamique conservé |
| Site local, Chrome 153 | Anglais à l’arrivée malgré locale FR et ancienne préférence FR ; français explicite, historique/rechargement, modal clavier et trois plateformes ; sans exception, 404 ou débordement à 1440, 1024, 390 et 320 pixels |
| Workflows | actionlint officiel 1.7.12 : release et deploy validés |

[Suite](validation/tests-0.0.3.log), [fixtures réelles](validation/live-validation-0.156.1.json), [application locale](validation/local-packaged-smoke-0.0.3.json), [assets](validation/assets-publication-0.0.3.json) et [delta CLI](CODEX-0.156.1-DELTA.md). Les correctifs audio évitent le rejeu de frames après mute et nettoient une préparation asynchrone annulée ; les 24 tests audio réussissent.

## Circuit de publication

Le workflow [Build desktop release](https://github.com/anisayari/codex-messenger/actions/workflows/release.yml) construit Windows x64, macOS arm64 et macOS x64 sur leurs hôtes natifs, lance l’application empaquetée et produit installateurs, preuves et SHA256SUMS. La release [v0.0.3](https://github.com/anisayari/codex-messenger/releases/tag/v0.0.3) est publiée après réussite des trois jobs. Le [déploiement](https://github.com/anisayari/codex-messenger/actions/workflows/deploy-codexmessenger-net.yml) exige une release correspondant au site, avec installateurs Windows/macOS téléversés et digests SHA256.

Le premier passage natif Windows a repéré une assertion trop stricte sur une URI de fichier : `~` et `%7E` désignent le même caractère. Le test conserve la vérification du chemin natif et de l’encodage des espaces. Les builds finaux sont relancés ensemble sur le commit corrigé avant publication. Les preuves de distribution et du [site en production](https://codexmessenger.net/) seront ajoutées après leur exécution réelle.

Les builds macOS sont unsigned et sans notarisation Developer ID ; la signature Authenticode Windows n’est pas fournie. Le smoke des paquets couvre leur démarrage et leur isolation, et les fixtures CLI dédiées couvrent le serveur réel. Aucun microphone ou caméra physique, appel vocal, OAuth externe, crédit de réinitialisation ou remplacement signé d’une app utilisateur n’a été exécuté. Voir [la matrice fonctionnelle](CODEX-MIGRATION.md).
