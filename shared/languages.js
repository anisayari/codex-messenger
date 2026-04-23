export const supportedLanguages = [
  {
    code: "fr",
    label: "Français",
    login: {
      subtitle: "Connexion au serveur local Codex",
      email: "Adresse de messagerie",
      displayName: "Nom affiche",
      personalMessage: "Message personnel",
      status: "Statut",
      language: "Langue",
      codexPath: "Chemin vers Codex CLI",
      autoPath: "Detection automatique via PATH",
      browse: "Parcourir",
      test: "Tester",
      online: "En ligne",
      away: "Absent",
      busy: "Occupe",
      offline: "Apparaitre hors ligne",
      remember: "Memoriser mon adresse",
      connect: "Connexion",
      connecting: "Connexion Codex...",
      hint: "Utilise `codex app-server` via le main process Electron. Aucune cle API n'est exposee au renderer.",
      found: "Codex detecte",
      missing: "Codex non detecte. Installez Codex, ajoutez-le au PATH, ou indiquez codex.exe/codex.cmd.",
      testOk: "Test OK",
      testFail: "Test impossible"
    },
    codexInstruction: "Reponds en francais par defaut sauf demande explicite de l'utilisateur."
  },
  {
    code: "en",
    label: "English",
    login: {
      subtitle: "Connect to the local Codex server",
      email: "Messaging address",
      displayName: "Display name",
      personalMessage: "Personal message",
      status: "Status",
      language: "Language",
      codexPath: "Codex CLI path",
      autoPath: "Auto-detect from PATH",
      browse: "Browse",
      test: "Test",
      online: "Online",
      away: "Away",
      busy: "Busy",
      offline: "Appear offline",
      remember: "Remember my address",
      connect: "Sign in",
      connecting: "Connecting Codex...",
      hint: "Uses `codex app-server` through the Electron main process. No API key is exposed to the renderer.",
      found: "Codex detected",
      missing: "Codex was not detected. Install Codex, add it to PATH, or select codex.exe/codex.cmd.",
      testOk: "Test OK",
      testFail: "Test failed"
    },
    codexInstruction: "Answer in English by default unless the user explicitly asks for another language."
  },
  {
    code: "es",
    label: "Español",
    login: {
      subtitle: "Conexión al servidor local de Codex",
      email: "Dirección de mensajería",
      displayName: "Nombre visible",
      personalMessage: "Mensaje personal",
      status: "Estado",
      language: "Idioma",
      codexPath: "Ruta de Codex CLI",
      autoPath: "Detección automática via PATH",
      browse: "Examinar",
      test: "Probar",
      online: "En línea",
      away: "Ausente",
      busy: "Ocupado",
      offline: "Aparecer sin conexión",
      remember: "Recordar mi dirección",
      connect: "Iniciar sesión",
      connecting: "Conectando Codex...",
      hint: "Usa `codex app-server` desde el proceso principal de Electron. No se expone ninguna clave API al renderer.",
      found: "Codex detectado",
      missing: "Codex no detectado. Instala Codex, añádelo al PATH o selecciona codex.exe/codex.cmd.",
      testOk: "Prueba OK",
      testFail: "Prueba imposible"
    },
    codexInstruction: "Responde en español por defecto salvo que el usuario pida explicitamente otro idioma."
  },
  {
    code: "ja",
    label: "日本語",
    login: {
      subtitle: "ローカル Codex サーバーに接続",
      email: "メッセージ アドレス",
      displayName: "表示名",
      personalMessage: "個人メッセージ",
      status: "状態",
      language: "言語",
      codexPath: "Codex CLI のパス",
      autoPath: "PATH から自動検出",
      browse: "参照",
      test: "テスト",
      online: "オンライン",
      away: "退席中",
      busy: "取り込み中",
      offline: "オフライン表示",
      remember: "アドレスを記憶",
      connect: "サインイン",
      connecting: "Codex に接続中...",
      hint: "`codex app-server` は Electron の main process 経由で実行されます。API キーは renderer に公開されません。",
      found: "Codex を検出しました",
      missing: "Codex が検出されません。Codex をインストールするか PATH に追加するか、codex.exe/codex.cmd を選択してください。",
      testOk: "テスト OK",
      testFail: "テストできません"
    },
    codexInstruction: "ユーザーが明示的に別の言語を指定しない限り、日本語で回答してください。"
  }
];

const languageByCode = new Map(supportedLanguages.map((language) => [language.code, language]));

export function normalizeLanguage(language, fallback = "fr") {
  const code = String(language ?? "").trim().toLowerCase();
  if (languageByCode.has(code)) return code;
  return languageByCode.has(fallback) ? fallback : supportedLanguages[0].code;
}

export function languageConfig(language) {
  return languageByCode.get(normalizeLanguage(language)) ?? supportedLanguages[0];
}

export function loginCopyFor(language) {
  return languageConfig(language).login;
}

export function codexLanguageInstruction(language) {
  return languageConfig(language).codexInstruction;
}
