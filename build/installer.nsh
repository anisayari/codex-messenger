!macro customInstall
  ; Legacy app versions run the NSIS installer with /S and then try to relaunch
  ; Codex Messenger from their own batch script. Launch here as well so silent
  ; updates still recover if the legacy relaunch path is malformed.
  IfSilent 0 +3
    IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 +2
      Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend
