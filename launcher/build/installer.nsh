; Nore Launcher – custom NSIS branding (included by electron-builder)
; colours must be defined before MUI2.nsh is included (this file is included first)
!define MUI_BGCOLOR "120E0B"
!define MUI_TEXTCOLOR "F6EFE8"

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Witaj w Nore Launcher"
  !define MUI_WELCOMEPAGE_TEXT "Ten kreator zainstaluje Nore Launcher – launcher Minecraft z własnym klientem PvP Nore Client.$\r$\n$\r$\n• wszystkie wersje Minecraft i Fabric$\r$\n• mody, paczki zasobów, shadery i datapacki z Modrinth$\r$\n• konta premium (Microsoft) i non-premium$\r$\n$\r$\nKliknij Dalej, aby kontynuować."
  !insertmacro MUI_PAGE_WELCOME
!macroend
