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
| Site en production, Chrome 153 | **37/37 contrôles réussis** : HTML brut, EN malgré locale FR et ancienne préférence FR, français explicite, historique/rechargement, modaux clavier/tactile, liens v0.0.3 et images ; zéro erreur à 1440, 390 et 320 pixels |
| Grille sociale mobile publiée | **16/16 contrôles ciblés en production réussis**, dont 12 configurations EN/FR ; les **12/12 cas locaux** réussissent aussi à 320, 360, 361, 379, 380 et 390 px ; texte dans les bordures et cibles de 48 px minimum, correction CSS à deux colonnes jusqu’à 379 px |
| Site local, Chrome 153 | Anglais à l’arrivée malgré locale FR et ancienne préférence FR ; français explicite, historique/rechargement, modal clavier et trois plateformes ; sans exception, 404 ou débordement à 1440, 1024, 390 et 320 pixels |
| Builds de distribution natifs | **3/3 réussis sur le même commit** : Windows x64, macOS arm64 et macOS Intel x64 ; chacun exécute le vrai CLI 0.156.1 et 14 contrôles de l’app empaquetée, zéro erreur et fermeture propre |
| Publication GitHub | **v0.0.3 publiée à 15:00:50 UTC** : six installateurs et quinze preuves/checksums ; les 21 tailles et SHA256 GitHub correspondent aux fichiers locaux |
| Workflows | actionlint officiel 1.7.12 validé ; CI et CodeQL du commit de distribution réussis |

[Suite](validation/tests-0.0.3.log), [fixtures réelles](validation/live-validation-0.156.1.json), [application locale](validation/local-packaged-smoke-0.0.3.json), [assets](validation/assets-publication-0.0.3.json) et [delta CLI](CODEX-0.156.1-DELTA.md). Les correctifs audio évitent le rejeu de frames après mute et nettoient une préparation asynchrone annulée ; les 24 tests audio réussissent.

## Circuit de publication

Le workflow [Build desktop release](https://github.com/anisayari/codex-messenger/actions/workflows/release.yml) construit Windows x64, macOS arm64 et macOS x64 sur leurs hôtes natifs, lance l’application empaquetée et produit installateurs, preuves et SHA256SUMS. La release [v0.0.3](https://github.com/anisayari/codex-messenger/releases/tag/v0.0.3) est publiée après réussite des trois jobs. Le [déploiement](https://github.com/anisayari/codex-messenger/actions/workflows/deploy-codexmessenger-net.yml) exige une release correspondant au site, avec installateurs Windows/macOS téléversés et digests SHA256.

Le premier passage natif Windows a repéré une assertion trop stricte sur une URI de fichier : `~` et `%7E` désignent le même caractère. Le test conserve la vérification du chemin natif et de l’encodage des espaces. Les trois builds finaux ont été reconstruits ensemble sur `592462a66d471b236eb8c9c2eef550c1ad3c9f9f` : [run de distribution](https://github.com/anisayari/codex-messenger/actions/runs/35877182271), [CI](https://github.com/anisayari/codex-messenger/actions/runs/35877174814) et [CodeQL](https://github.com/anisayari/codex-messenger/actions/runs/35877174720). Windows termine avec 259 tests, 254 réussis et cinq skips qualifiés ; macOS avec 259 tests, 256 réussis et trois opt-in ignorés. La fixture CLI dédiée exécute bien son test réel sur les trois plateformes, sans skip.

Les [preuves originales des builds](validation/release-0.0.3/verified-downloads.json) sont conservées. GitHub normalise les espaces des noms Windows en points : les [checksums publics](validation/release-0.0.3/published/SHA256SUMS-windows-x64.txt) et le [manifeste Windows publié](validation/release-0.0.3/published/artifact-manifest-windows-x64.json) utilisent donc les noms téléchargés, sans modifier les binaires. [Les 21 assets publiés](validation/release-0.0.3/published/release-api-verification.json) ont été contrôlés par leurs tailles et digests distants.

Le site a été publié depuis `1b3542f731a81c8537830258df033668967717fa`, qui aligne le HTML mobile brut sur les cinq textes anglais déjà validés après JavaScript : [déploiement réussi](https://github.com/anisayari/codex-messenger/actions/runs/35878432705), [HTTP/HTTPS et fichiers exacts](validation/site-production-http-0.0.3.json), [six téléchargements publics accessibles](validation/site-production-downloads-0.0.3.json), [37 contrôles navigateur réussis](validation/site-production-browser-0.0.3.md). La dernière stable a été [reconfirmée à 15:04:57 UTC](validation/final-cli-latest-0.156.1.json).

La revue visuelle a ensuite repéré un léger débordement de libellés sociaux à 320 px. Une retouche CSS affiche deux colonnes jusqu’à 379 px ; les [12 validations locales](validation/site-social-grid-local-0.0.3.json) réussissent en EN/FR autour du seuil, sans débordement ni réduction des cibles. Le [déploiement final](https://github.com/anisayari/codex-messenger/actions/runs/35879714229) a réussi depuis `ea557a2904bad7c1612b55004fb6c89e99354b03`, avec CI et CodeQL réussis. Les [16 contrôles ciblés en production](validation/site-social-grid-production-0.0.3.md) passent : les libellés restent dans leurs bordures, les cibles font au moins 48 px et il n’y a aucun débordement ou erreur. Le HTML publié correspond exactement à la source transformée, SHA256 `0c44b86a10c9af25991c594d1e16582d2cd37d57760474acd5cef923ce0d4253`. La release publique et les six téléchargements sont disponibles sans authentification.

Les builds macOS sont unsigned et sans notarisation Developer ID ; la signature Authenticode Windows n’est pas fournie. Le smoke des paquets couvre leur démarrage et leur isolation, et les fixtures CLI dédiées couvrent le serveur réel. Aucun microphone ou caméra physique, appel vocal, OAuth externe, crédit de réinitialisation ou remplacement signé d’une app utilisateur n’a été exécuté. Voir [la matrice fonctionnelle](CODEX-MIGRATION.md).
