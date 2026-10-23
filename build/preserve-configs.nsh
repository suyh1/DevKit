; configs contains user-owned project data. Keep it in place on upgrade/uninstall.
; This replaces electron-builder's recursive removal of the entire install folder.
!macro customRemoveFiles
  SetOutPath "$TEMP"
  FindFirst $R0 $R1 "$INSTDIR\*"
  devkit_remove_next:
    StrCmp $R1 "" devkit_remove_done
    StrCmp $R1 "." devkit_remove_continue
    StrCmp $R1 ".." devkit_remove_continue
    StrCmp $R1 "configs" devkit_remove_continue
    RMDir /r "$INSTDIR\$R1"
    Delete "$INSTDIR\$R1"
  devkit_remove_continue:
    FindNext $R0 $R1
    Goto devkit_remove_next
  devkit_remove_done:
    FindClose $R0
    ; Non-recursive: succeeds only when there is no retained data.
    RMDir "$INSTDIR"
!macroend
