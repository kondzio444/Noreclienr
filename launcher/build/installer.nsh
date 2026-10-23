; Nore Launcher 1.4 Beta – custom NSIS branding (included by electron-builder before its own script)
; colours must be defined before MUI2.nsh is included (this file is included first)
!define MUI_BGCOLOR "0D0913"
!define MUI_TEXTCOLOR "F3EEFA"

; ---------------------------------------------------------------- installer
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Witaj w Nore Launcher 1.4 Beta"
  !define MUI_WELCOMEPAGE_TEXT "Ten kreator zainstaluje Nore Launcher – launcher Minecraft z własnym klientem PvP Nore Client.$\r$\n$\r$\nCo nowego w wersji 1.4 Beta:$\r$\n• nowy ekran główny i zwijane menu boczne$\r$\n• znajomi – zobacz, w co grają inni$\r$\n• galeria zrzutów ekranu z gry (F2)$\r$\n• kreator pierwszego uruchomienia: konto, wygląd, RAM$\r$\n• auto-naprawa uszkodzonych instancji$\r$\n$\r$\nTwoje instancje, światy i ustawienia zostaną zachowane.$\r$\n$\r$\nKliknij Dalej, aby kontynuować."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Replaces electron-builder's default finish page. Keeps its "run after finish" behaviour
; (StartApp passes --updated after an update) and adds a desktop shortcut option and a release-notes link.
; Silent installs (/S --updated --force-run from the manual updater) never show this page: the app is started by
; installSection.nsh exactly as before. Interactive updates (quitAndInstall) relaunch through StartApp with --updated.
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "Uruchom Nore Launcher"
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif

  !define MUI_FINISHPAGE_TITLE "Nore Launcher 1.4 Beta jest gotowy!"
  !define MUI_FINISHPAGE_TEXT "Instalacja zakończyła się pomyślnie. Przy pierwszym uruchomieniu kreator pomoże Ci dodać konto, wybrać wygląd launchera i pamięć RAM."
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Utwórz skrót na pulpicie"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "noreDesktopShortcutNoop"
  !define MUI_FINISHPAGE_LINK "Co nowego w 1.4 Beta – informacje o wydaniu"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/kondzio444/Noreclienr/releases"
  !define MUI_FINISHPAGE_LINK_COLOR "C8A8FF"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW "noreFinishShow"
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE "noreFinishLeave"
  !insertmacro MUI_PAGE_FINISH

  ; defined after MUI_PAGE_FINISH so that $mui.FinishPage.ShowReadme is already declared
  Function noreDesktopShortcutNoop
  FunctionEnd

  ; after an update with UI, don't bring back a desktop shortcut the player has removed
  Function noreFinishShow
    ${If} ${isUpdated}
    ${AndIfNot} ${FileExists} "$newDesktopLink"
      SendMessage $mui.FinishPage.ShowReadme ${BM_SETCHECK} ${BST_UNCHECKED} 0
    ${EndIf}
  FunctionEnd

  Function noreFinishLeave
    SendMessage $mui.FinishPage.ShowReadme ${BM_GETCHECK} 0 0 $0
    ${If} $0 = ${BST_CHECKED}
      ${IfNot} ${FileExists} "$newDesktopLink"
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${EndIf}
    ${Else}
      ${If} ${FileExists} "$newDesktopLink"
        WinShell::UninstShortcut "$newDesktopLink"
        Delete "$newDesktopLink"
      ${EndIf}
    ${EndIf}
  FunctionEnd
!macroend

; ---------------------------------------------------------------- uninstaller
!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Odinstalowanie Nore Launcher"
  !define MUI_WELCOMEPAGE_TEXT "Ten kreator usunie Nore Launcher 1.4 Beta z komputera.$\r$\n$\r$\nTwoje instancje, światy, zrzuty ekranu i ustawienia zostaną zachowane na dysku – po ponownej instalacji wszystko będzie na swoim miejscu.$\r$\n$\r$\nKliknij Dalej, aby kontynuować."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!ifdef BUILD_UNINSTALLER
  ; consumed by the uninstaller's only finish page (MUI_UNPAGE_FINISH)
  !define MUI_FINISHPAGE_TITLE "Do zobaczenia!"
  !define MUI_FINISHPAGE_TEXT "Nore Launcher został odinstalowany.$\r$\n$\r$\nDziękujemy za grę z Nore Client. Kliknij Zakończ, aby zamknąć kreator."
!endif
