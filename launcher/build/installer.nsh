; Nore Launcher – NSIS branding in the Album direction (DESIGN.md §8 "Installer", design/mocks/installer.html).
; Windows chrome and the system buttons stay Windows; the dialog is the black album page, the sidebar and
; header bitmaps are the album cover (drawn by scripts/installer-art.py from design/tokens.json).
; Included by electron-builder before its own script: colours must be defined before MUI2.nsh.
!define MUI_BGCOLOR "141216"
!define MUI_TEXTCOLOR "F3EFE9"

; progress bar: the theme is removed so the bar can take the accent fill on a slot track
!ifndef PBM_SETBARCOLOR
  !define PBM_SETBARCOLOR 0x0409
!endif
!ifndef PBM_SETBKCOLOR
  !define PBM_SETBKCOLOR 0x2001
!endif
!ifndef LVM_SETBKCOLOR
  !define LVM_SETBKCOLOR 0x1001
!endif
!ifndef LVM_SETTEXTCOLOR
  !define LVM_SETTEXTCOLOR 0x1024
!endif
!ifndef LVM_SETTEXTBKCOLOR
  !define LVM_SETTEXTBKCOLOR 0x1026
!endif
; COLORREF is 0x00BBGGRR: accent #9d5cff, slot #0c0b0e, ink-soft #b3abb0
!define NORE_BAR 0x00FF5C9D
!define NORE_SLOT 0x000E0B0C
!define NORE_LOG_INK 0x00B0ABB3

; Styles the instfiles page of the running (un)installer: unthemed progress bar in the accent on a slot
; track, and the details log as a slot well. Called from the page's show function and from the sections.
!macro NORE_STYLE_PROGRESS
  Push $R0
  Push $R1
  Push $R2
  FindWindow $R0 "#32770" "" $HWNDPARENT
  GetDlgItem $R1 $R0 1004
  System::Call 'UxTheme::SetWindowTheme(p R1, w "", w "")'
  SendMessage $R1 ${PBM_SETBARCOLOR} 0 ${NORE_BAR}
  SendMessage $R1 ${PBM_SETBKCOLOR} 0 ${NORE_SLOT}
  GetDlgItem $R2 $R0 1016
  SendMessage $R2 ${LVM_SETBKCOLOR} 0 ${NORE_SLOT}
  SendMessage $R2 ${LVM_SETTEXTBKCOLOR} 0 ${NORE_SLOT}
  SendMessage $R2 ${LVM_SETTEXTCOLOR} 0 ${NORE_LOG_INK}
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

; ---------------------------------------------------------------- installer
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Witaj w Nore Launcher 1.4 Beta"
  !define MUI_WELCOMEPAGE_TEXT "Ten kreator zainstaluje Nore Launcher, launcher Minecraft z wbudowanym klientem PvP Nore Client.$\r$\n$\r$\nCo nowego w 1.4 Beta:$\r$\n•  nowy wygląd: Twój album Nore$\r$\n•  Nore MC, oficjalny serwer, jednym kliknięciem$\r$\n•  znajomi i czat: zobacz, w co grają inni$\r$\n•  wydarzenia: Halloween i seria zimowa$\r$\n$\r$\nLogowanie nie jest wymagane – zagrasz na samym nicku. Twoje instancje, światy i ustawienia zostaną zachowane. Kliknij Dalej, aby kontynuować."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; inserted right before electron-builder's MUI_PAGE_INSTFILES: its show function styles the progress bar
!macro customPageAfterChangeDir
  !define MUI_PAGE_HEADER_TEXT "Instalowanie"
  !define MUI_PAGE_HEADER_SUBTEXT "Kopiuję pliki Nore Launcher na dysk."
  !define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Zainstalowano"
  !define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Twoje instancje i światy zostały na miejscu."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW noreInstFilesShow
  Function noreInstFilesShow
    !insertmacro NORE_STYLE_PROGRESS
  FunctionEnd
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

  !define MUI_FINISHPAGE_TITLE "Twój album Nore jest gotowy"
  !define MUI_FINISHPAGE_TEXT "Instalacja zakończyła się pomyślnie. Przy pierwszym uruchomieniu kreator pomoże Ci wpisać nick (albo dodać konto Microsoft), wybrać kolor okładki i pamięć RAM."
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Utwórz skrót na pulpicie"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "noreDesktopShortcutNoop"
  !define MUI_FINISHPAGE_LINK "Co nowego w 1.4 Beta – informacje o wydaniu"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/kondzio444/Noreclienr/releases"
  !define MUI_FINISHPAGE_LINK_COLOR "C6A3FF"
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
  !define MUI_WELCOMEPAGE_TEXT "Ten kreator usunie Nore Launcher z komputera.$\r$\n$\r$\nTwoje instancje, światy, zrzuty ekranu i ustawienia zostaną na dysku – po ponownej instalacji album otworzy się tam, gdzie go zostawiłeś.$\r$\n$\r$\nKliknij Dalej, aby kontynuować."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

; the uninstall section runs while its progress page is shown: the same unthemed accent bar
!macro customUnInstall
  !insertmacro NORE_STYLE_PROGRESS
!macroend

!ifdef BUILD_UNINSTALLER
  ; consumed by the uninstaller's only finish page (MUI_UNPAGE_FINISH)
  !define MUI_FINISHPAGE_TITLE "Do zobaczenia!"
  !define MUI_FINISHPAGE_TEXT "Nore Launcher został odinstalowany.$\r$\n$\r$\nDziękujemy za grę z Nore Client. Kliknij Zakończ, aby zamknąć kreator."
!endif
