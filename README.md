![Codex Messenger](public/icons/codex-messenger-people.png)

# Codex Messenger

Codex Messenger est un client desktop Electron inspire de MSN Messenger 7 pour utiliser Codex en local, projet par projet, avec des conversations separees, le Wizz, les sons MSN, l'envoi de fichiers/images, la camera, les messages vocaux et des mini-jeux pendant que Codex reflechit.

L'application parle francais par defaut. L'anglais est disponible depuis l'ecran de connexion.

## Fonctionnalites

- Interface desktop Windows style MSN Messenger / Windows XP.
- Connexion locale a `codex app-server` depuis le process principal Electron.
- Aucune cle API exposee au renderer.
- Une conversation par agent, projet local ou fil Codex existant.
- Liste de contacts façon Messenger avec groupes, projets et fils recents.
- Envoi d'images/fichiers a Codex.
- Capture camera et sauvegarde locale avant envoi.
- Enregistrement de message vocal en fichier local.
- Wizz avec son et secousse de fenetre quand Codex termine.
- Rappel Wizz si un nouveau message reste non lu.
- Mini-jeux locaux: Morpion, Memory, Wizz Reflex.
- Packaging Windows: installateur `.exe` et version portable.

## Installation facile

### Option 1: installer depuis une release

1. Ouvrir la page [Releases](https://github.com/anisayari/codex-messenger/releases).
2. Télécharger `Codex Messenger Setup ... .exe`.
3. Lancer l'installateur.
4. Au premier lancement, choisir la langue et verifier que Codex est detecte.

Si Windows SmartScreen affiche un avertissement, c'est normal pour une application non signee. Cliquer sur "Informations complementaires", puis "Executer quand meme" uniquement si le fichier vient bien de la release GitHub officielle.

### Option 2: lancer depuis le code source

Prerequis:

- Node.js 20 ou plus recent.
- npm.
- Codex CLI installe localement.

```powershell
git clone https://github.com/anisayari/codex-messenger.git
cd codex-messenger
npm install
npm run check:codex
npm run electron:start
```

## Detection de Codex

Codex Messenger essaie de trouver Codex automatiquement dans cet ordre:

1. Le chemin indique dans l'ecran de connexion.
2. La variable d'environnement `CODEX_MESSENGER_CODEX_PATH`.
3. Le `PATH` systeme (`where codex` sur Windows, `which codex` sur macOS/Linux).

Si Codex n'est pas detecte:

- cliquer sur `Parcourir` dans l'ecran de connexion;
- selectionner `codex.exe`, `codex.cmd` ou le binaire equivalent;
- cliquer sur `Tester`;
- relancer la connexion.

Exemple de fallback manuel sous PowerShell:

```powershell
$env:CODEX_MESSENGER_CODEX_PATH="C:\Users\vous\AppData\Roaming\npm\codex.cmd"
npm run electron:start
```

## Langue

Le francais est la langue par defaut.

Depuis l'ecran de connexion, choisir:

- `Francais`
- `English`

Le choix est sauvegarde dans les donnees utilisateur de l'application. Codex Messenger ajoute aussi cette preference aux instructions envoyees a Codex.

## Creer un `.exe` Windows

Depuis Windows:

```powershell
npm install
npm run package:win
```

Les fichiers generes arrivent dans:

```text
release/
```

La configuration produit:

- un installateur NSIS `.exe`;
- une version portable `.exe`;
- des raccourcis menu Demarrer / Bureau via l'installateur.

Le build n'est pas signe. Pour une distribution publique large, il faudra ajouter une signature de code Windows.

## Developpement

Interface web seule:

```powershell
npm run dev
```

Application Electron en mode dev:

```powershell
npm run electron:dev
```

Build renderer:

```powershell
npm run build
```

Smoke test Electron:

```powershell
npm run electron:smoke
```

## Donnees locales

En mode developpement, les fichiers temporaires sont dans le dossier du projet.

En mode application installee, les settings et uploads sont stockes dans le dossier utilisateur Electron (`userData`) pour eviter d'ecrire dans `app.asar`.

## Variables utiles

```powershell
# Chemin manuel vers Codex CLI
$env:CODEX_MESSENGER_CODEX_PATH="C:\chemin\vers\codex.cmd"

# Dossier de travail par defaut pour Codex en app packagee
$env:CODEX_MESSENGER_WORKSPACE="C:\Users\vous\Desktop\projects"

# Racine scannee pour la liste de projets
$env:CODEX_MESSENGER_PROJECTS_ROOT="C:\Users\vous\Desktop\projects"

# Delai avant Wizz de rappel non lu, en millisecondes
$env:MSN_UNREAD_WIZZ_MS="300000"
```

## Licence

MIT. Voir [LICENSE](LICENSE).
