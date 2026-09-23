; Silent installs never start the app. The caller owns any relaunch.
; Missing generated payload data must stop compilation rather than weaken the guard.
!addincludedir "${BUILD_RESOURCES_DIR}"
!include "installer-files.generated.nsh"

!ifdef BUILD_UNINSTALLER
!define CM_GUARD_PREFIX "un."
!else
!define CM_GUARD_PREFIX ""
!endif

Var cmGuardPath
Var cmGuardLeaf
Var cmGuardIndex
Var cmGuardChar
Var cmGuardRelative
Var cmGuardEntry
Var cmGuardHandle
Var cmGuardName
Var cmGuardAttributes
Var cmGuardMask
Var cmGuardLastError
Var cmGuardFindData
Var cmGuardFindResult
Var cmTracePhase
Var cmTraceEnabled
Var cmTraceFile
Var cmProcessResult
Var cmProcessAttempts
!ifndef BUILD_UNINSTALLER
Var cmGuardOldPath
!endif

Function ${CM_GUARD_PREFIX}cmTracePhase
  Pop $cmTracePhase
  ReadEnvStr $cmTraceEnabled "CODEX_MESSENGER_INSTALLER_SMOKE_TRACE"
  StrCmp $cmTraceEnabled "1" 0 cm_trace_done
  ; QA opts in with an isolated TEMP. Never accept an arbitrary trace destination.
  ClearErrors
  FileOpen $cmTraceFile "$TEMP\codex-messenger-installer-smoke.trace" a
  IfErrors cm_trace_done
  FileSeek $cmTraceFile 0 END
  IfErrors cm_trace_close
  FileWrite $cmTraceFile "$cmTracePhase$\r$\n"
cm_trace_close:
  FileClose $cmTraceFile
cm_trace_done:
  ClearErrors
FunctionEnd

Function ${CM_GUARD_PREFIX}cmCheckAppRunning
  StrCpy $cmProcessAttempts 0
cm_process_retry:
  ; Only 603 proves absence. Every enumeration error must stop before modifying files.
  nsProcess::_FindProcess /NOUNLOAD "${PRODUCT_FILENAME}.exe"
  Pop $cmProcessResult
  StrCmp $cmProcessResult 603 cm_process_done
  StrCmp $cmProcessResult 0 cm_process_running cm_process_error
cm_process_running:
  Push "PROCESS_FOUND"
  Call ${CM_GUARD_PREFIX}cmTracePhase
  IfSilent cm_process_wait cm_process_prompt
cm_process_wait:
  ; An updater may already be exiting. Give it two seconds without terminating it.
  IntCmp $cmProcessAttempts 10 cm_process_stop cm_process_sleep cm_process_stop
cm_process_sleep:
  Sleep 200
  IntOp $cmProcessAttempts $cmProcessAttempts + 1
  Goto cm_process_retry
cm_process_prompt:
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Codex Messenger is running. Close the application, then click Retry to continue." /SD IDCANCEL IDRETRY cm_process_retry
  Goto cm_process_stop
cm_process_error:
  Push "PROCESS_CHECK_ERROR"
  Call ${CM_GUARD_PREFIX}cmTracePhase
  DetailPrint "Cannot verify whether Codex Messenger is running (native process check: $cmProcessResult)."
  MessageBox MB_OK|MB_ICONSTOP "Codex Messenger could not safely check running applications. Close the application and try again. No application files have been changed." /SD IDOK
cm_process_stop:
  nsProcess::_Unload
  SetErrorLevel 42
  Quit
cm_process_done:
  Push "PROCESS_ABSENT"
  Call ${CM_GUARD_PREFIX}cmTracePhase
  nsProcess::_Unload
  ClearErrors
  Return
FunctionEnd

Function ${CM_GUARD_PREFIX}cmFindDirectoryLeaf
  StrCpy $cmGuardLeaf ""
  StrLen $cmGuardIndex $cmGuardPath
cm_leaf_loop:
  IntOp $cmGuardIndex $cmGuardIndex - 1
  IntCmp $cmGuardIndex 0 cm_leaf_char cm_leaf_done cm_leaf_char
cm_leaf_char:
  StrCpy $cmGuardChar $cmGuardPath 1 $cmGuardIndex
  StrCmp $cmGuardChar "\" cm_leaf_done
  StrCpy $cmGuardLeaf "$cmGuardChar$cmGuardLeaf"
  Goto cm_leaf_loop
cm_leaf_done:
  Return
FunctionEnd

Function ${CM_GUARD_PREFIX}cmGuardInstallDirectory
  Pop $cmGuardPath
  Push "DIRECTORY_GUARD_ENTER"
  Call ${CM_GUARD_PREFIX}cmTracePhase
  GetFullPathName $cmGuardPath "$cmGuardPath"
  Call ${CM_GUARD_PREFIX}cmFindDirectoryLeaf
  StrCmp $cmGuardLeaf "${APP_FILENAME}" cm_leaf_valid
  StrCmp $cmGuardLeaf "codex-messenger" cm_leaf_valid
  StrCmp $cmGuardLeaf "CodexMessenger" cm_leaf_valid
  Goto cm_unsafe
cm_leaf_valid:
  System::Call 'kernel32::GetFileAttributesW(w "$cmGuardPath") i .s ?e'
  Pop $cmGuardLastError
  Pop $cmGuardAttributes
  StrCmp $cmGuardAttributes -1 cm_guard_missing
  IntOp $cmGuardMask $cmGuardAttributes & 0x10
  IntCmp $cmGuardMask 0 cm_unsafe
  IntOp $cmGuardMask $cmGuardAttributes & 0x400
  IntCmp $cmGuardMask 0 +2
  Goto cm_unsafe
  Push ""
  Call ${CM_GUARD_PREFIX}cmGuardPayloadTree
cm_guard_done:
  Push "DIRECTORY_GUARD_DONE"
  Call ${CM_GUARD_PREFIX}cmTracePhase
  Return
cm_guard_missing:
  ; Only a genuinely absent target is safe. Access errors must fail closed.
  StrCmp $cmGuardLastError 2 cm_guard_done
  StrCmp $cmGuardLastError 3 cm_guard_done
  Goto cm_unsafe
cm_unsafe:
  DetailPrint "Installation stopped: this is not a dedicated Codex Messenger directory, or it contains linked files."
  MessageBox MB_OK|MB_ICONSTOP "Codex Messenger will not remove a shared directory or linked files. Move the application to a dedicated directory before continuing. Your Codex account and app settings are preserved." /SD IDOK
  SetErrorLevel 42
  Quit
FunctionEnd

Function ${CM_GUARD_PREFIX}cmGuardPayloadTree
  Pop $cmGuardRelative
  ; WIN32_FIND_DATAW is 592 bytes; cFileName begins at byte 44.
  ; NSIS FindNext does not distinguish normal EOF from an enumeration error.
  System::Alloc 592
  Pop $cmGuardFindData
  StrCmp $cmGuardFindData 0 cm_payload_unsafe
  System::Call 'kernel32::FindFirstFileW(w "$cmGuardPath\$cmGuardRelative*", p $cmGuardFindData) p .s ?e'
  Pop $cmGuardLastError
  Pop $cmGuardHandle
  StrCmp $cmGuardHandle -1 cm_payload_unsafe
  Call ${CM_GUARD_PREFIX}cmReadFindData
cm_tree_loop:
  StrCmp $cmGuardName "" cm_payload_unsafe
  StrCmp $cmGuardName "." cm_tree_next
  StrCmp $cmGuardName ".." cm_tree_next
  StrCpy $cmGuardEntry "$cmGuardRelative$cmGuardName"
  System::Call 'kernel32::GetFileAttributesW(w "$cmGuardPath\$cmGuardEntry") i .s'
  Pop $cmGuardAttributes
  StrCmp $cmGuardAttributes -1 cm_payload_unsafe
  IntOp $cmGuardMask $cmGuardAttributes & 0x400
  IntCmp $cmGuardMask 0 +2
  Goto cm_payload_unsafe
  !insertmacro CM_CHECK_PAYLOAD_ENTRY
  Goto cm_payload_unsafe
cm_entry_file:
  IntOp $cmGuardMask $cmGuardAttributes & 0x10
  IntCmp $cmGuardMask 0 cm_tree_next
  Goto cm_payload_unsafe
cm_entry_directory:
  IntOp $cmGuardMask $cmGuardAttributes & 0x10
  IntCmp $cmGuardMask 0 cm_payload_unsafe
  ; Preserve the caller's enumeration frame across recursion.
  Push $cmGuardHandle
  Push $cmGuardName
  Push $cmGuardRelative
  Push $cmGuardFindData
  Push "$cmGuardEntry\"
  Call ${CM_GUARD_PREFIX}cmGuardPayloadTree
  Pop $cmGuardFindData
  Pop $cmGuardRelative
  Pop $cmGuardName
  Pop $cmGuardHandle
cm_tree_next:
  System::Call 'kernel32::FindNextFileW(p $cmGuardHandle, p $cmGuardFindData) i .s ?e'
  Pop $cmGuardLastError
  Pop $cmGuardFindResult
  StrCmp $cmGuardFindResult 0 cm_tree_end
  Call ${CM_GUARD_PREFIX}cmReadFindData
  Goto cm_tree_loop
cm_tree_end:
  StrCmp $cmGuardLastError 18 cm_tree_done
  Goto cm_payload_unsafe
cm_tree_done:
  System::Call 'kernel32::FindClose(p $cmGuardHandle)'
  System::Free $cmGuardFindData
  ClearErrors
  Return
cm_payload_unsafe:
  DetailPrint "Unrecognized or linked file: $cmGuardPath\$cmGuardEntry"
  MessageBox MB_OK|MB_ICONSTOP "Codex Messenger will not remove files added to its installation directory. Move your files out before continuing. No application files or profile data have been removed." /SD IDOK
  SetErrorLevel 42
  Quit
FunctionEnd

Function ${CM_GUARD_PREFIX}cmReadFindData
  Push $0
  System::Call '*$cmGuardFindData(&v44, &w260 .r0)'
  StrCpy $cmGuardName $0
  Pop $0
FunctionEnd

!ifndef BUILD_UNINSTALLER
Function cmNormalizeInstallDirectory
  Push "NORMALIZE_ENTER"
  Call cmTracePhase
  GetFullPathName $INSTDIR "$INSTDIR"
  StrCpy $cmGuardPath "$INSTDIR"
  Call cmFindDirectoryLeaf
  StrCmp $cmGuardLeaf "${APP_FILENAME}" cm_target_check
  ; A selected custom parent always receives a dedicated product subdirectory.
  StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
cm_target_check:
  Push "$INSTDIR"
  Call cmGuardInstallDirectory
  Push "NORMALIZE_DONE"
  Call cmTracePhase
FunctionEnd

Function cmCheckDirectoryPage
  Call cmNormalizeInstallDirectory
  Abort
FunctionEnd
!endif

!macro preInit
  !ifndef BUILD_UNINSTALLER
  Push "PRE_INIT"
  Call cmTracePhase
  !endif
!macroend

!macro customInit
  Push "CUSTOM_INIT_ENTER"
  Call cmTracePhase
  ; Guard legacy locations before electron-builder invokes their old uninstaller.
  ReadRegStr $cmGuardOldPath HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $cmGuardOldPath "" +3
  Push "$cmGuardOldPath"
  Call cmGuardInstallDirectory
  ReadRegStr $cmGuardOldPath HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $cmGuardOldPath "" +3
  Push "$cmGuardOldPath"
  Call cmGuardInstallDirectory
  Call cmNormalizeInstallDirectory
  Push "CUSTOM_INIT_DONE"
  Call cmTracePhase
!macroend

!macro customCheckAppRunning
  Push "PROCESS_CHECK_ENTER"
  !ifdef BUILD_UNINSTALLER
    Call un.cmTracePhase
  !else
    Call cmTracePhase
  !endif
  !ifdef BUILD_UNINSTALLER
    Call un.cmCheckAppRunning
  !else
    Call cmCheckAppRunning
  !endif
  Push "PROCESS_CHECK_DONE"
  !ifdef BUILD_UNINSTALLER
    Call un.cmTracePhase
  !else
    Call cmTracePhase
  !endif
!macroend

!macro customPageAfterChangeDir
  Page custom cmCheckDirectoryPage
!macroend

!macro customUnInit
  Push "UNINSTALL_INIT_ENTER"
  Call un.cmTracePhase
  Push "$INSTDIR"
  Call un.cmGuardInstallDirectory
  Push "UNINSTALL_INIT_DONE"
  Call un.cmTracePhase
!macroend

!macro customInstall
  Push "INSTALL_DONE"
  Call cmTracePhase
  ; No autostart: silent and automated installs leave launching to the caller.
!macroend

!macro customFiles_x64
  Push "PAYLOAD_EXTRACTION_DONE"
  Call cmTracePhase
!macroend

!undef CM_GUARD_PREFIX
