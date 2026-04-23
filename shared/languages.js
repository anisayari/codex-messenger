export const supportedLanguages = [
  {
    code: "fr",
    label: "Français",
    login: {
      subtitle: "Connexion au serveur local Codex",
      email: "Adresse de messagerie",
      displayName: "Nom affiché",
      personalMessage: "Message personnel",
      status: "Statut",
      language: "Langue",
      codexPath: "Chemin vers Codex CLI",
      autoPath: "Détection automatique via PATH",
      browse: "Parcourir",
      test: "Tester",
      online: "En ligne",
      away: "Absent",
      busy: "Occupé",
      offline: "Apparaître hors ligne",
      openAiSession: "Session OpenAI",
      sessionReady: "Connectée",
      sessionRequired: "Login requis",
      rememberPassword: "Mémoriser ma session OpenAI",
      signAutomatically: "Me connecter automatiquement",
      serviceStatus: "État du service",
      reconnecting: "Reconnexion...",
      remember: "Mémoriser mon adresse",
      connect: "Connexion",
      connecting: "Connexion à Codex...",
      hint: "Utilise `codex app-server` via le processus principal Electron. Aucune clé API n'est exposée au renderer.",
      found: "Codex détecté",
      missing: "Codex non détecté. Installe Codex, ajoute-le au PATH, ou indique le chemin vers le binaire codex.",
      npmMissing: "Node.js/npm est nécessaire pour installer Codex CLI.",
      installCodex: "Installer Codex CLI",
      installingCodex: "Installation Codex...",
      loginCodex: "Login OpenAI",
      loginStarted: "Une fenêtre de terminal a été ouverte pour le login OpenAI/Codex. Reviens ici puis clique sur Tester.",
      loginMissing: "Login OpenAI requis",
      openNode: "Installer Node.js",
      testOk: "Test OK",
      testFail: "Test impossible"
    },
    codexInstruction: "Réponds en français par défaut sauf demande explicite de l'utilisateur."
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
      openAiSession: "OpenAI session",
      sessionReady: "Connected",
      sessionRequired: "Login required",
      rememberPassword: "Remember my OpenAI session",
      signAutomatically: "Sign me in automatically",
      serviceStatus: "Service status",
      reconnecting: "Reconnecting...",
      remember: "Remember my address",
      connect: "Sign in",
      connecting: "Connecting Codex...",
      hint: "Uses `codex app-server` through the Electron main process. No API key is exposed to the renderer.",
      found: "Codex detected",
      missing: "Codex was not detected. Install Codex, add it to PATH, or select the codex binary.",
      npmMissing: "Node.js/npm is required to install Codex CLI.",
      installCodex: "Install Codex CLI",
      installingCodex: "Installing Codex...",
      loginCodex: "OpenAI login",
      loginStarted: "A terminal window was opened for OpenAI/Codex login. Come back here and click Test.",
      loginMissing: "OpenAI login required",
      openNode: "Install Node.js",
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
      autoPath: "Detección automática vía PATH",
      browse: "Examinar",
      test: "Probar",
      online: "En línea",
      away: "Ausente",
      busy: "Ocupado",
      offline: "Aparecer sin conexión",
      openAiSession: "Sesión OpenAI",
      sessionReady: "Conectada",
      sessionRequired: "Login requerido",
      rememberPassword: "Recordar mi sesión OpenAI",
      signAutomatically: "Iniciar sesión automáticamente",
      serviceStatus: "Estado del servicio",
      reconnecting: "Reconectando...",
      remember: "Recordar mi dirección",
      connect: "Iniciar sesión",
      connecting: "Conectando Codex...",
      hint: "Usa `codex app-server` desde el proceso principal de Electron. No se expone ninguna clave API al renderer.",
      found: "Codex detectado",
      missing: "Codex no detectado. Instala Codex, añádelo al PATH o selecciona el binario codex.",
      npmMissing: "Node.js/npm es necesario para instalar Codex CLI.",
      installCodex: "Instalar Codex CLI",
      installingCodex: "Instalando Codex...",
      loginCodex: "Login OpenAI",
      loginStarted: "Se abrió una ventana de terminal para iniciar sesión en OpenAI/Codex. Vuelve aquí y pulsa Probar.",
      loginMissing: "Login OpenAI requerido",
      openNode: "Instalar Node.js",
      testOk: "Prueba OK",
      testFail: "Prueba imposible"
    },
    codexInstruction: "Responde en español por defecto salvo que el usuario pida explícitamente otro idioma."
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
      openAiSession: "OpenAI セッション",
      sessionReady: "接続済み",
      sessionRequired: "ログインが必要です",
      rememberPassword: "OpenAI セッションを記憶",
      signAutomatically: "自動的にサインイン",
      serviceStatus: "サービス状態",
      reconnecting: "再接続中...",
      remember: "アドレスを記憶",
      connect: "サインイン",
      connecting: "Codex に接続中...",
      hint: "`codex app-server` は Electron の main process 経由で実行されます。API キーは renderer に公開されません。",
      found: "Codex を検出しました",
      missing: "Codex が検出されません。Codex をインストールするか PATH に追加するか、codex バイナリを選択してください。",
      npmMissing: "Codex CLI のインストールには Node.js/npm が必要です。",
      installCodex: "Codex CLI をインストール",
      installingCodex: "Codex をインストール中...",
      loginCodex: "OpenAI ログイン",
      loginStarted: "OpenAI/Codex ログイン用のターミナルを開きました。戻ってからテストを押してください。",
      loginMissing: "OpenAI ログインが必要です",
      openNode: "Node.js をインストール",
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
