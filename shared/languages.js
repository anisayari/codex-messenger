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
  },
  {
    code: "ar",
    label: "العربية",
    login: {
      subtitle: "الاتصال بخادم Codex المحلي",
      email: "عنوان المراسلة",
      displayName: "اسم العرض",
      personalMessage: "الرسالة الشخصية",
      status: "الحالة",
      language: "اللغة",
      codexPath: "مسار Codex CLI",
      autoPath: "اكتشاف تلقائي عبر PATH",
      browse: "استعراض",
      test: "اختبار",
      online: "متصل",
      away: "غائب",
      busy: "مشغول",
      offline: "الظهور دون اتصال",
      openAiSession: "جلسة OpenAI",
      sessionReady: "متصل",
      sessionRequired: "تسجيل الدخول مطلوب",
      rememberPassword: "تذكر جلسة OpenAI",
      signAutomatically: "تسجيل الدخول تلقائيا",
      serviceStatus: "حالة الخدمة",
      reconnecting: "جار إعادة الاتصال...",
      remember: "تذكر العنوان",
      connect: "تسجيل الدخول",
      connecting: "جار الاتصال بـ Codex...",
      hint: "يستخدم `codex app-server` عبر عملية Electron الرئيسية. لا يتم كشف أي مفتاح API للواجهة.",
      found: "تم العثور على Codex",
      missing: "لم يتم العثور على Codex. ثبته أو أضفه إلى PATH أو اختر ملف codex التنفيذي.",
      npmMissing: "Node.js/npm مطلوب لتثبيت Codex CLI.",
      installCodex: "تثبيت Codex CLI",
      installingCodex: "جار تثبيت Codex...",
      loginCodex: "تسجيل دخول OpenAI",
      loginStarted: "تم فتح نافذة طرفية لتسجيل الدخول إلى OpenAI/Codex. عد هنا ثم اضغط اختبار.",
      loginMissing: "تسجيل دخول OpenAI مطلوب",
      openNode: "تثبيت Node.js",
      testOk: "نجح الاختبار",
      testFail: "تعذر الاختبار"
    },
    codexInstruction: "أجب بالعربية افتراضيا ما لم يطلب المستخدم لغة أخرى صراحة."
  }
];

const appCopy = {
  fr: {
    status: { online: "En ligne", busy: "Occupe", brb: "De retour bientot", away: "Absent", phone: "Au telephone", lunch: "Parti manger", offline: "Hors ligne", appearOffline: "Apparaitre hors ligne" },
    common: { apply: "Appliquer", cancel: "Annuler", close: "Fermer", loading: "Connexion...", update: "Update", enabled: "activees", disabled: "desactivees" },
    updates: { aboutTitle: "A propos de Codex Messenger", developedBy: "Developpe par Anis AYARI et Codex.", productDescription: "Client Electron local inspire de MSN Messenger 7, connecte a codex app-server.", productFront: "Codex Messenger front", productServer: "Codex app-server", currentVersion: "Version actuelle", localVersion: "Version locale", latestVersion: "Derniere version", updateAutomatically: "Update automatiquement", openReleases: "Ouvrir les releases", updating: "Update en cours...", never: "jamais", checkedAt: "Derniere verification: {checkedAt}.", privacyNote: "Codex Messenger ne stocke pas les conversations Codex: l'application est seulement un front client local.", check: "Verifier mise a jour", checking: "Verification...", restart: "Redemarrer", download: "Telechargement", installing: "Installation...", verifyingInstall: "Verification de l'installation...", restarting: "Redemarrage en cours...", ready: "Pret.", progressInProgress: "Mise a jour en cours...", unknown: "inconnue", notChecked: "Non verifie", updateAvailableLine: "Mise a jour disponible: {version}", checkIncomplete: "Verification incomplete: {error}", upToDate: "A jour" },
    settings: {
      title: "Parametres",
      notifications: "Notifications de nouveau message",
      sound: "Son a chaque nouveau message",
      unreadWizz: "Wizz de rappel quand un message reste non lu",
      autoSignIn: "Connexion automatique au demarrage",
      language: "Langue",
      unreadDelay: "Delai du Wizz de rappel (secondes)",
      closeBehavior: "Quand je ferme la fenetre principale",
      closeAsk: "Demander",
      closeHide: "Laisser en arriere-plan",
      closeQuit: "Fermer definitivement",
      saving: "Enregistrement..."
    },
    menu: {
      file: "Fichier", contacts: "Contacts", actions: "Actions", tools: "Outils", settings: "Parametres", help: "Aide", edit: "Edition", format: "Format",
      newConversation: "Nouvelle conversation Codex", openDemo: "Ouvrir l'espace de presentation...", openProject: "Ouvrir un projet...", editProfile: "Modifier mon profil...", about: "A propos de Codex Messenger...", checkUpdates: "Verifier mise a jour", openAppFolder: "Ouvrir le dossier de l'app", quit: "Quitter",
      addContact: "Add a Contact", codexToday: "Codex Today", refreshList: "Rafraichir la liste", statusPrefix: "Statut", wizzCodex: "Wizz Codex", uploadsFolder: "Dossier uploads", reloadWindow: "Relancer cette fenetre", minimize: "Minimiser", maximize: "Maximiser / restaurer",
      openSettings: "Ouvrir les parametres...", wizzDelay: "Delai Wizz rappel...", notificationsState: "Notifications", soundState: "Son nouveau message", unreadWizzState: "Wizz de rappel", server: "Serveur Codex",
      sendFiles: "Envoyer fichiers...", saveConversation: "Sauvegarder conversation...", closeWindow: "Fermer", undo: "Annuler", cut: "Couper", copy: "Copier", paste: "Coller", selectAll: "Tout selectionner", clearText: "Effacer le texte",
      textAppearance: "Apparence du texte...", textSize: "Taille du texte...", resetText: "Reinitialiser le texte", invite: "Invite", sendWink: "Envoyer un clin d'oeil", emoticons: "Emoticones", searchTranscript: "Rechercher dans l'historique...", zoomDefault: "Zoom par defaut", activities: "Activities", games: "Games",
      startCamera: "Demarrer la camera", voiceClip: "Voice Clip", stopVoiceClip: "Stop Voice Clip", sendImageFile: "Envoyer image/fichier...", openUploadsFolder: "Ouvrir uploads", keyboardShortcuts: "Raccourcis clavier"
    },
    roster: { codexAgents: "Agents Codex", projects: "Projets", recentConversations: "Conversations recentes", search: "Search...", localConnected: "Codex local connecte", sortProjects: "Trier Projects par", rename: "Renommer", renameAction: "Renommer...", newName: "Nouveau nom", originalName: "Nom original", openFolder: "Ouvrir le dossier", loadMore: "Afficher plus de conversations", loading: "Chargement...", newThread: "Nouveau fil Codex", reduce: "Reduire", expand: "Developper" },
    chat: { conversation: "Conversation", contactInfo: "Infos du contact", renameSession: "Renommer la session...", openProject: "Ouvrir le projet", sessionPrefix: "Session", model: "Modele", reasoning: "Reflexion", execution: "Execution", sandbox: "Zone d'autorisation", confirmation: "Confirmation", askContext: "Demander le contexte a Codex", myProfile: "Mon profil", changePicture: "Changer mon image...", defaultPicture: "Image par defaut", typing: "ecrit...", send: "Send", search: "Search", stop: "Stop" },
    toolbar: { invite: "Invite", files: "Send Files", video: "Video", voice: "Voice", stop: "Stop", activities: "Activities", games: "Games" }
  },
  en: {
    status: { online: "Online", busy: "Busy", brb: "Be right back", away: "Away", phone: "On the phone", lunch: "Out to lunch", offline: "Offline", appearOffline: "Appear offline" },
    common: { apply: "Apply", cancel: "Cancel", close: "Close", loading: "Connecting...", update: "Update", enabled: "enabled", disabled: "disabled" },
    updates: { aboutTitle: "About Codex Messenger", developedBy: "Developed by Anis AYARI and Codex.", productDescription: "Local Electron client inspired by MSN Messenger 7 and connected to codex app-server.", productFront: "Codex Messenger front", productServer: "Codex app-server", currentVersion: "Current version", localVersion: "Local version", latestVersion: "Latest version", updateAutomatically: "Update automatically", openReleases: "Open releases", updating: "Updating...", never: "never", checkedAt: "Last check: {checkedAt}.", privacyNote: "Codex Messenger does not store Codex conversations: the app is only a local client front.", check: "Check for updates", checking: "Checking...", restart: "Restart", download: "Download", installing: "Installing...", verifyingInstall: "Verifying installation...", restarting: "Restarting...", ready: "Ready.", progressInProgress: "Update in progress...", unknown: "unknown", notChecked: "Not checked", updateAvailableLine: "Update available: {version}", checkIncomplete: "Check incomplete: {error}", upToDate: "Up to date" },
    settings: { title: "Settings", notifications: "New message notifications", sound: "Sound for each new message", unreadWizz: "Reminder Wizz for unread messages", autoSignIn: "Sign in automatically at startup", language: "Language", unreadDelay: "Reminder Wizz delay (seconds)", closeBehavior: "When I close the main window", closeAsk: "Ask", closeHide: "Keep running in background", closeQuit: "Quit completely", saving: "Saving..." },
    menu: { file: "File", contacts: "Contacts", actions: "Actions", tools: "Tools", settings: "Settings", help: "Help", edit: "Edit", format: "Format", newConversation: "New Codex conversation", openDemo: "Open presentation space...", openProject: "Open project...", editProfile: "Edit my profile...", about: "About Codex Messenger...", checkUpdates: "Check for updates", openAppFolder: "Open app folder", quit: "Quit", addContact: "Add a Contact", codexToday: "Codex Today", refreshList: "Refresh list", statusPrefix: "Status", wizzCodex: "Wizz Codex", uploadsFolder: "Uploads folder", reloadWindow: "Reload this window", minimize: "Minimize", maximize: "Maximize / restore", openSettings: "Open settings...", wizzDelay: "Reminder Wizz delay...", notificationsState: "Notifications", soundState: "New message sound", unreadWizzState: "Reminder Wizz", server: "Codex server", sendFiles: "Send Files...", saveConversation: "Save Conversation...", closeWindow: "Close", undo: "Undo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select All", clearText: "Clear Text", textAppearance: "Text Appearance...", textSize: "Text Size...", resetText: "Reset Conversation Text", invite: "Invite", sendWink: "Send Wink", emoticons: "Emoticons", searchTranscript: "Search Transcript...", zoomDefault: "Default zoom", activities: "Activities", games: "Games", startCamera: "Start Camera", voiceClip: "Voice Clip", stopVoiceClip: "Stop Voice Clip", sendImageFile: "Send Image/File...", openUploadsFolder: "Open uploads folder", keyboardShortcuts: "Keyboard Shortcuts" },
    roster: { codexAgents: "Codex Agents", projects: "Projects", recentConversations: "Recent conversations", search: "Search...", localConnected: "Local Codex connected", sortProjects: "Sort Projects by", rename: "Rename", renameAction: "Rename...", newName: "New name", originalName: "Original name", openFolder: "Open folder", loadMore: "Show more conversations", loading: "Loading...", newThread: "New Codex thread", reduce: "Collapse", expand: "Expand" },
    chat: { conversation: "Conversation", contactInfo: "Contact info", renameSession: "Rename session...", openProject: "Open project", sessionPrefix: "Session", model: "Model", reasoning: "Reasoning", execution: "Execution", sandbox: "Authorization zone", confirmation: "Confirmation", askContext: "Ask Codex for context", myProfile: "My profile", changePicture: "Change my picture...", defaultPicture: "Default picture", typing: "is typing...", send: "Send", search: "Search", stop: "Stop" },
    toolbar: { invite: "Invite", files: "Send Files", video: "Video", voice: "Voice", stop: "Stop", activities: "Activities", games: "Games" }
  },
  es: {
    status: { online: "En línea", busy: "Ocupado", brb: "Vuelvo pronto", away: "Ausente", phone: "Al teléfono", lunch: "Salí a comer", offline: "Sin conexión", appearOffline: "Aparecer sin conexión" },
    common: { apply: "Aplicar", cancel: "Cancelar", close: "Cerrar", loading: "Conectando...", update: "Actualizar", enabled: "activadas", disabled: "desactivadas" },
    updates: { aboutTitle: "Acerca de Codex Messenger", developedBy: "Desarrollado por Anis AYARI y Codex.", productDescription: "Cliente Electron local inspirado en MSN Messenger 7 y conectado a codex app-server.", productFront: "Front Codex Messenger", productServer: "Codex app-server", currentVersion: "Versión actual", localVersion: "Versión local", latestVersion: "Última versión", updateAutomatically: "Actualizar automáticamente", openReleases: "Abrir releases", updating: "Actualizando...", never: "nunca", checkedAt: "Última verificación: {checkedAt}.", privacyNote: "Codex Messenger no almacena conversaciones Codex: la aplicación solo es un cliente local.", check: "Buscar actualización", checking: "Verificando...", restart: "Reiniciar", download: "Descarga", installing: "Instalando...", verifyingInstall: "Verificando instalación...", restarting: "Reiniciando...", ready: "Listo.", progressInProgress: "Actualización en curso...", unknown: "desconocida", notChecked: "No verificado", updateAvailableLine: "Actualización disponible: {version}", checkIncomplete: "Verificación incompleta: {error}", upToDate: "Actualizado" },
    settings: { title: "Ajustes", notifications: "Notificaciones de nuevo mensaje", sound: "Sonido para cada nuevo mensaje", unreadWizz: "Wizz de recordatorio para mensajes no leídos", autoSignIn: "Conexión automática al iniciar", language: "Idioma", unreadDelay: "Retraso del Wizz de recordatorio (segundos)", closeBehavior: "Cuando cierro la ventana principal", closeAsk: "Preguntar", closeHide: "Mantener en segundo plano", closeQuit: "Cerrar por completo", saving: "Guardando..." },
    menu: { file: "Archivo", contacts: "Contactos", actions: "Acciones", tools: "Herramientas", settings: "Ajustes", help: "Ayuda", edit: "Editar", format: "Formato", newConversation: "Nueva conversación Codex", openDemo: "Abrir espacio de presentación...", openProject: "Abrir proyecto...", editProfile: "Editar mi perfil...", about: "Acerca de Codex Messenger...", checkUpdates: "Buscar actualizaciones", openAppFolder: "Abrir carpeta de la app", quit: "Salir", addContact: "Agregar contacto", codexToday: "Codex Today", refreshList: "Actualizar lista", statusPrefix: "Estado", wizzCodex: "Wizz Codex", uploadsFolder: "Carpeta de subidas", reloadWindow: "Recargar esta ventana", minimize: "Minimizar", maximize: "Maximizar / restaurar", openSettings: "Abrir ajustes...", wizzDelay: "Retraso de Wizz...", notificationsState: "Notificaciones", soundState: "Sonido de nuevo mensaje", unreadWizzState: "Wizz de recordatorio", server: "Servidor Codex", sendFiles: "Enviar archivos...", saveConversation: "Guardar conversación...", closeWindow: "Cerrar", undo: "Deshacer", cut: "Cortar", copy: "Copiar", paste: "Pegar", selectAll: "Seleccionar todo", clearText: "Borrar texto", textAppearance: "Apariencia del texto...", textSize: "Tamaño del texto...", resetText: "Restablecer texto", invite: "Invitar", sendWink: "Enviar guiño", emoticons: "Emoticonos", searchTranscript: "Buscar en historial...", zoomDefault: "Zoom predeterminado", activities: "Actividades", games: "Juegos", startCamera: "Iniciar cámara", voiceClip: "Clip de voz", stopVoiceClip: "Detener clip de voz", sendImageFile: "Enviar imagen/archivo...", openUploadsFolder: "Abrir subidas", keyboardShortcuts: "Atajos de teclado" },
    roster: { codexAgents: "Agentes Codex", projects: "Proyectos", recentConversations: "Conversaciones recientes", search: "Buscar...", localConnected: "Codex local conectado", sortProjects: "Ordenar proyectos por", rename: "Renombrar", renameAction: "Renombrar...", newName: "Nuevo nombre", originalName: "Nombre original", openFolder: "Abrir carpeta", loadMore: "Mostrar más conversaciones", loading: "Cargando...", newThread: "Nuevo hilo Codex", reduce: "Reducir", expand: "Expandir" },
    chat: { conversation: "Conversación", contactInfo: "Información del contacto", renameSession: "Renombrar sesión...", openProject: "Abrir proyecto", sessionPrefix: "Sesión", model: "Modelo", reasoning: "Razonamiento", execution: "Ejecución", sandbox: "Zona de autorización", confirmation: "Confirmación", askContext: "Pedir contexto a Codex", myProfile: "Mi perfil", changePicture: "Cambiar mi imagen...", defaultPicture: "Imagen predeterminada", typing: "está escribiendo...", send: "Enviar", search: "Buscar", stop: "Detener" },
    toolbar: { invite: "Invitar", files: "Enviar archivos", video: "Video", voice: "Voz", stop: "Detener", activities: "Actividades", games: "Juegos" }
  },
  ja: {
    status: { online: "オンライン", busy: "取り込み中", brb: "すぐ戻ります", away: "退席中", phone: "通話中", lunch: "昼食中", offline: "オフライン", appearOffline: "オフライン表示" },
    common: { apply: "適用", cancel: "キャンセル", close: "閉じる", loading: "接続中...", update: "更新", enabled: "有効", disabled: "無効" },
    updates: { aboutTitle: "Codex Messenger について", developedBy: "Anis AYARI と Codex が開発しました。", productDescription: "MSN Messenger 7 に着想を得た、codex app-server 接続のローカル Electron クライアントです。", productFront: "Codex Messenger フロント", productServer: "Codex app-server", currentVersion: "現在のバージョン", localVersion: "ローカルバージョン", latestVersion: "最新バージョン", updateAutomatically: "自動更新", openReleases: "リリースを開く", updating: "更新中...", never: "未確認", checkedAt: "最終確認: {checkedAt}。", privacyNote: "Codex Messenger は Codex の会話を保存しません。このアプリはローカルクライアントです。", check: "更新を確認", checking: "確認中...", restart: "再起動", download: "ダウンロード", installing: "インストール中...", verifyingInstall: "インストールを確認中...", restarting: "再起動中...", ready: "準備完了。", progressInProgress: "更新中...", unknown: "不明", notChecked: "未確認", updateAvailableLine: "更新があります: {version}", checkIncomplete: "確認未完了: {error}", upToDate: "最新" },
    settings: { title: "設定", notifications: "新着メッセージ通知", sound: "新着メッセージごとに音を鳴らす", unreadWizz: "未読メッセージのリマインダー Wizz", autoSignIn: "起動時に自動サインイン", language: "言語", unreadDelay: "リマインダー Wizz の遅延 (秒)", closeBehavior: "メインウィンドウを閉じるとき", closeAsk: "確認する", closeHide: "バックグラウンドで実行", closeQuit: "完全に終了", saving: "保存中..." },
    menu: { file: "ファイル", contacts: "連絡先", actions: "アクション", tools: "ツール", settings: "設定", help: "ヘルプ", edit: "編集", format: "書式", newConversation: "新しい Codex 会話", openDemo: "プレゼンテーション空間を開く...", openProject: "プロジェクトを開く...", editProfile: "プロフィールを編集...", about: "Codex Messenger について...", checkUpdates: "更新を確認", openAppFolder: "アプリフォルダを開く", quit: "終了", addContact: "連絡先を追加", codexToday: "Codex Today", refreshList: "リストを更新", statusPrefix: "状態", wizzCodex: "Wizz Codex", uploadsFolder: "アップロードフォルダ", reloadWindow: "このウィンドウを再読み込み", minimize: "最小化", maximize: "最大化 / 復元", openSettings: "設定を開く...", wizzDelay: "Wizz 遅延...", notificationsState: "通知", soundState: "新着音", unreadWizzState: "リマインダー Wizz", server: "Codex サーバー", sendFiles: "ファイルを送信...", saveConversation: "会話を保存...", closeWindow: "閉じる", undo: "元に戻す", cut: "切り取り", copy: "コピー", paste: "貼り付け", selectAll: "すべて選択", clearText: "テキストを消去", textAppearance: "テキスト表示...", textSize: "文字サイズ...", resetText: "会話テキストをリセット", invite: "招待", sendWink: "ウィンクを送信", emoticons: "絵文字", searchTranscript: "履歴を検索...", zoomDefault: "標準ズーム", activities: "アクティビティ", games: "ゲーム", startCamera: "カメラを開始", voiceClip: "ボイスクリップ", stopVoiceClip: "ボイスクリップ停止", sendImageFile: "画像/ファイルを送信...", openUploadsFolder: "アップロードを開く", keyboardShortcuts: "キーボードショートカット" },
    roster: { codexAgents: "Codex エージェント", projects: "プロジェクト", recentConversations: "最近の会話", search: "検索...", localConnected: "ローカル Codex 接続済み", sortProjects: "プロジェクトの並び替え", rename: "名前変更", renameAction: "名前変更...", newName: "新しい名前", originalName: "元の名前", openFolder: "フォルダを開く", loadMore: "会話をさらに表示", loading: "読み込み中...", newThread: "新しい Codex スレッド", reduce: "折りたたむ", expand: "展開" },
    chat: { conversation: "会話", contactInfo: "連絡先情報", renameSession: "セッション名を変更...", openProject: "プロジェクトを開く", sessionPrefix: "セッション", model: "モデル", reasoning: "推論", execution: "実行", sandbox: "認可ゾーン", confirmation: "確認", askContext: "Codex にコンテキストを依頼", myProfile: "自分のプロフィール", changePicture: "画像を変更...", defaultPicture: "既定の画像", typing: "が入力中...", send: "送信", search: "検索", stop: "停止" },
    toolbar: { invite: "招待", files: "ファイル送信", video: "ビデオ", voice: "音声", stop: "停止", activities: "アクティビティ", games: "ゲーム" }
  },
  ar: {
    status: { online: "متصل", busy: "مشغول", brb: "سأعود قريبا", away: "غائب", phone: "على الهاتف", lunch: "خرجت للغداء", offline: "غير متصل", appearOffline: "الظهور دون اتصال" },
    common: { apply: "تطبيق", cancel: "إلغاء", close: "إغلاق", loading: "جار الاتصال...", update: "تحديث", enabled: "مفعلة", disabled: "معطلة" },
    updates: { aboutTitle: "حول Codex Messenger", developedBy: "طوره Anis AYARI و Codex.", productDescription: "عميل Electron محلي مستوحى من MSN Messenger 7 ومتصل بـ codex app-server.", productFront: "واجهة Codex Messenger", productServer: "Codex app-server", currentVersion: "الإصدار الحالي", localVersion: "الإصدار المحلي", latestVersion: "آخر إصدار", updateAutomatically: "تحديث تلقائي", openReleases: "فتح الإصدارات", updating: "جار التحديث...", never: "أبدا", checkedAt: "آخر تحقق: {checkedAt}.", privacyNote: "لا يخزن Codex Messenger محادثات Codex: التطبيق مجرد واجهة محلية.", check: "التحقق من التحديث", checking: "جار التحقق...", restart: "إعادة التشغيل", download: "تنزيل", installing: "جار التثبيت...", verifyingInstall: "جار التحقق من التثبيت...", restarting: "جار إعادة التشغيل...", ready: "جاهز.", progressInProgress: "التحديث جار...", unknown: "غير معروف", notChecked: "لم يتم التحقق", updateAvailableLine: "يتوفر تحديث: {version}", checkIncomplete: "التحقق غير مكتمل: {error}", upToDate: "محدث" },
    settings: { title: "الإعدادات", notifications: "إشعارات الرسائل الجديدة", sound: "صوت لكل رسالة جديدة", unreadWizz: "تنبيه Wizz للرسائل غير المقروءة", autoSignIn: "تسجيل الدخول تلقائيا عند البدء", language: "اللغة", unreadDelay: "تأخير تنبيه Wizz (بالثواني)", closeBehavior: "عند إغلاق النافذة الرئيسية", closeAsk: "اسألني", closeHide: "ابق في الخلفية", closeQuit: "إغلاق نهائي", saving: "جار الحفظ..." },
    menu: { file: "ملف", contacts: "جهات الاتصال", actions: "إجراءات", tools: "أدوات", settings: "إعدادات", help: "مساعدة", edit: "تحرير", format: "تنسيق", newConversation: "محادثة Codex جديدة", openDemo: "فتح مساحة العرض...", openProject: "فتح مشروع...", editProfile: "تعديل ملفي الشخصي...", about: "حول Codex Messenger...", checkUpdates: "التحقق من التحديثات", openAppFolder: "فتح مجلد التطبيق", quit: "إنهاء", addContact: "إضافة جهة اتصال", codexToday: "Codex اليوم", refreshList: "تحديث القائمة", statusPrefix: "الحالة", wizzCodex: "Wizz Codex", uploadsFolder: "مجلد الرفع", reloadWindow: "إعادة تحميل هذه النافذة", minimize: "تصغير", maximize: "تكبير / استعادة", openSettings: "فتح الإعدادات...", wizzDelay: "تأخير Wizz...", notificationsState: "الإشعارات", soundState: "صوت الرسائل الجديدة", unreadWizzState: "تنبيه Wizz", server: "خادم Codex", sendFiles: "إرسال ملفات...", saveConversation: "حفظ المحادثة...", closeWindow: "إغلاق", undo: "تراجع", cut: "قص", copy: "نسخ", paste: "لصق", selectAll: "تحديد الكل", clearText: "مسح النص", textAppearance: "مظهر النص...", textSize: "حجم النص...", resetText: "إعادة ضبط نص المحادثة", invite: "دعوة", sendWink: "إرسال غمزة", emoticons: "الرموز التعبيرية", searchTranscript: "بحث في السجل...", zoomDefault: "الزوم الافتراضي", activities: "الأنشطة", games: "الألعاب", startCamera: "تشغيل الكاميرا", voiceClip: "مقطع صوتي", stopVoiceClip: "إيقاف المقطع الصوتي", sendImageFile: "إرسال صورة/ملف...", openUploadsFolder: "فتح مجلد الرفع", keyboardShortcuts: "اختصارات لوحة المفاتيح" },
    roster: { codexAgents: "وكلاء Codex", projects: "المشاريع", recentConversations: "المحادثات الأخيرة", search: "بحث...", localConnected: "Codex المحلي متصل", sortProjects: "فرز المشاريع حسب", rename: "إعادة تسمية", renameAction: "إعادة تسمية...", newName: "الاسم الجديد", originalName: "الاسم الأصلي", openFolder: "فتح المجلد", loadMore: "عرض المزيد من المحادثات", loading: "جار التحميل...", newThread: "سلسلة Codex جديدة", reduce: "طي", expand: "توسيع" },
    chat: { conversation: "محادثة", contactInfo: "معلومات جهة الاتصال", renameSession: "إعادة تسمية الجلسة...", openProject: "فتح المشروع", sessionPrefix: "الجلسة", model: "النموذج", reasoning: "التفكير", execution: "التنفيذ", sandbox: "منطقة التفويض", confirmation: "التأكيد", askContext: "اطلب السياق من Codex", myProfile: "ملفي الشخصي", changePicture: "تغيير صورتي...", defaultPicture: "الصورة الافتراضية", typing: "يكتب...", send: "إرسال", search: "بحث", stop: "إيقاف" },
    toolbar: { invite: "دعوة", files: "إرسال ملفات", video: "فيديو", voice: "صوت", stop: "إيقاف", activities: "أنشطة", games: "ألعاب" }
  }
};

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

export function appCopyFor(language) {
  return appCopy[normalizeLanguage(language)] ?? appCopy.fr;
}

export function codexLanguageInstruction(language) {
  return languageConfig(language).codexInstruction;
}
