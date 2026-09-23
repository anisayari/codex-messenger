# Changelogs officiels Codex

Cette archive conserve les notes officielles intégrales de **51 versions stables**, de **0.125.0 à 0.156.1**. Dernière vérification npm/GitHub : **23 septembre 2026**, entre 14:17 et 14:21 UTC. Les préversions alpha/beta et les drafts sont exclus.

Le [manifeste JSON](releases.json) contient les corps officiels, leurs SHA256, les dates de publication et les liens sources. Le [delta 0.156.1](../CODEX-0.156.1-DELTA.md) documente le hotfix et sa compatibilité avec 0.156.0 ; le [delta 0.156.0](../CODEX-0.156.0-DELTA.md) reste la trace de la migration précédente.

## Vérification de couverture

Le registre npm complet annonce **51 versions stables dans cet intervalle** ; les 51 versions sont présentes, sans omission ni doublon. Depuis le snapshot officiel du 2026-09-22T21:09:27.585Z, l’unique ajout stable est 0.156.1. Les 50 corps déjà archivés conservent leur SHA256 vérifié ; le nouveau corps est récupéré depuis [l’API de son tag officiel](https://api.github.com/repos/openai/codex/releases/tags/rust-v0.156.1). Les quatre pages GitHub de 100 releases du snapshot précédent restent des sources historiques, avec leur date conservée dans le manifeste ; elles ne sont pas présentées comme relues aujourd’hui.

Sources actuelles : [registre npm](https://registry.npmjs.org/@openai%2fcodex), [dist-tags npm](https://registry.npmjs.org/-/package/@openai/codex/dist-tags), [dernière release GitHub](https://api.github.com/repos/openai/codex/releases/latest). npm latest et GitHub latest concordent sur **0.156.1**. Les versions 0.126.0 et 0.127.0 ne figurent pas dans les releases stables de cet intervalle ; aucun changelog de ces versions n’est inventé.

## Contrat app-server 0.156.1

Les deux CLI officiels ont généré des schémas en isolation. **746/746 JSON sont identiques octet par octet** entre 0.156.0 et 0.156.1, annotations comprises : 310 standard et 436 expérimentaux. Le standard expose 101 méthodes client, 10 demandes serveur et 82 notifications ; l’expérimental expose 164, 11 et 82. Ces routes ne garantissent pas leur disponibilité pour chaque compte, profil ou produit hôte.

Preuves : [méthodes 0.156.1](protocol-methods-0.156.1.json), [comparaison des schémas](protocol-compatibility-0.156.0--0.156.1.json), [intégrité des CLI officiels](cli-integrity-0.156.0--0.156.1.json). Le [snapshot des méthodes 0.156.0](protocol-methods-0.156.0.json) est conservé.

## Versions archivées

| Version | Publication UTC | Corps officiel | Source |
|---|---|---|---|
| 0.125.0 | 2026-04-24T18:00:38Z | [0.125.0.md](0.125.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.125.0) |
| 0.128.0 | 2026-04-30T16:40:28Z | [0.128.0.md](0.128.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.128.0) |
| 0.129.0 | 2026-05-07T17:02:13Z | [0.129.0.md](0.129.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.129.0) |
| 0.130.0 | 2026-05-08T23:09:55Z | [0.130.0.md](0.130.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.130.0) |
| 0.131.0 | 2026-05-18T17:39:34Z | [0.131.0.md](0.131.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.131.0) |
| 0.132.0 | 2026-05-20T01:52:52Z | [0.132.0.md](0.132.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.132.0) |
| 0.133.0 | 2026-05-21T16:48:03Z | [0.133.0.md](0.133.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.133.0) |
| 0.134.0 | 2026-05-26T19:13:26Z | [0.134.0.md](0.134.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.134.0) |
| 0.135.0 | 2026-05-28T17:31:35Z | [0.135.0.md](0.135.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.135.0) |
| 0.136.0 | 2026-06-01T17:49:22Z | [0.136.0.md](0.136.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.136.0) |
| 0.137.0 | 2026-06-04T01:17:20Z | [0.137.0.md](0.137.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.137.0) |
| 0.138.0 | 2026-06-08T23:00:27Z | [0.138.0.md](0.138.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.138.0) |
| 0.139.0 | 2026-06-09T20:13:29Z | [0.139.0.md](0.139.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.139.0) |
| 0.140.0 | 2026-06-15T21:06:37Z | [0.140.0.md](0.140.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.140.0) |
| 0.141.0 | 2026-06-18T04:43:06Z | [0.141.0.md](0.141.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.141.0) |
| 0.142.0 | 2026-06-22T22:19:53Z | [0.142.0.md](0.142.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.142.0) |
| 0.142.1 | 2026-06-25T00:36:09Z | [0.142.1.md](0.142.1.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.142.1) |
| 0.142.2 | 2026-06-25T07:32:07Z | [0.142.2.md](0.142.2.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.142.2) |
| 0.142.3 | 2026-06-26T21:29:20Z | [0.142.3.md](0.142.3.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.142.3) |
| 0.142.4 | 2026-06-29T05:04:25Z | [0.142.4.md](0.142.4.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.142.4) |
| 0.142.5 | 2026-07-01T01:15:44Z | [0.142.5.md](0.142.5.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.142.5) |
| 0.143.0 | 2026-07-08T01:31:10Z | [0.143.0.md](0.143.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.143.0) |
| 0.144.0 | 2026-07-09T16:47:12Z | [0.144.0.md](0.144.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.144.0) |
| 0.144.1 | 2026-07-09T23:02:40Z | [0.144.1.md](0.144.1.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.144.1) |
| 0.144.2 | 2026-07-13T04:39:22Z | [0.144.2.md](0.144.2.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.144.2) |
| 0.144.3 | 2026-07-13T06:12:19Z | [0.144.3.md](0.144.3.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.144.3) |
| 0.144.4 | 2026-07-14T05:08:11Z | [0.144.4.md](0.144.4.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.144.4) |
| 0.144.5 | 2026-07-16T02:54:48Z | [0.144.5.md](0.144.5.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.144.5) |
| 0.144.6 | 2026-07-18T13:51:52Z | [0.144.6.md](0.144.6.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.144.6) |
| 0.145.0 | 2026-07-21T18:21:04Z | [0.145.0.md](0.145.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.145.0) |
| 0.146.0 | 2026-07-29T01:42:51Z | [0.146.0.md](0.146.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.146.0) |
| 0.146.1 | 2026-08-05T15:55:06Z | [0.146.1.md](0.146.1.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.146.1) |
| 0.147.0 | 2026-08-07T01:41:49Z | [0.147.0.md](0.147.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.147.0) |
| 0.148.0 | 2026-08-18T22:26:03Z | [0.148.0.md](0.148.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.148.0) |
| 0.149.0 | 2026-08-20T21:04:55Z | [0.149.0.md](0.149.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.149.0) |
| 0.149.1 | 2026-08-24T00:28:28Z | [0.149.1.md](0.149.1.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.149.1) |
| 0.150.0 | 2026-08-26T19:37:28Z | [0.150.0.md](0.150.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.150.0) |
| 0.150.1 | 2026-08-27T01:56:54Z | [0.150.1.md](0.150.1.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.150.1) |
| 0.151.0 | 2026-08-29T09:55:39Z | [0.151.0.md](0.151.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.151.0) |
| 0.152.0 | 2026-09-01T01:58:32Z | [0.152.0.md](0.152.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.152.0) |
| 0.152.1 | 2026-09-01T22:33:02Z | [0.152.1.md](0.152.1.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.152.1) |
| 0.153.0 | 2026-09-03T01:37:38Z | [0.153.0.md](0.153.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.153.0) |
| 0.153.1 | 2026-09-03T21:02:56Z | [0.153.1.md](0.153.1.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.153.1) |
| 0.153.2 | 2026-09-03T23:53:12Z | [0.153.2.md](0.153.2.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.153.2) |
| 0.153.3 | 2026-09-04T19:01:32Z | [0.153.3.md](0.153.3.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.153.3) |
| 0.153.4 | 2026-09-04T23:25:48Z | [0.153.4.md](0.153.4.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.153.4) |
| 0.154.0 | 2026-09-09T22:35:38Z | [0.154.0.md](0.154.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.154.0) |
| 0.155.0 | 2026-09-17T23:14:43Z | [0.155.0.md](0.155.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.155.0) |
| 0.155.1 | 2026-09-18T20:03:04Z | [0.155.1.md](0.155.1.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.155.1) |
| 0.156.0 | 2026-09-22T19:51:01Z | [0.156.0.md](0.156.0.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.156.0) |
| 0.156.1 | 2026-09-23T02:41:36Z | [0.156.1.md](0.156.1.md) | [GitHub](https://github.com/openai/codex/releases/tag/rust-v0.156.1) |
