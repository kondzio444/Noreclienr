; Nore Launcher (Tauri) – NSIS branding, the same as the Electron installer (launcher/build/installer.nsh):
; the black album page, the cover bitmaps (installerHeader.bmp / installerSidebar.bmp from
; scripts/installer-art.py) and event-orange checkbox labels on the finish page (installer.nsi).
; Included by the template before the pages, so the colours apply to every page.
!define MUI_BGCOLOR "141216"
!define MUI_TEXTCOLOR "F3EFE9"
!define NORE_CHECK_INK "FF8A1F"

!define MUI_WELCOMEPAGE_TITLE "Witaj w Nore Launcher"
!define MUI_WELCOMEPAGE_TEXT "Ten kreator zainstaluje Nore Launcher, launcher Minecraft z wbudowanym klientem PvP Nore Client.$\r$\n$\r$\nLogowanie nie jest wymagane – zagrasz na samym nicku. Twoje instancje, światy i ustawienia zostaną zachowane. Kliknij Dalej, aby kontynuować."
!define MUI_FINISHPAGE_TITLE "Twój album Nore jest gotowy"
!define MUI_FINISHPAGE_TEXT "Instalacja zakończyła się pomyślnie. Przy pierwszym uruchomieniu kreator pomoże Ci wpisać nick (albo dodać konto Microsoft), wybrać kolor okładki i pamięć RAM."
!define MUI_FINISHPAGE_LINK "Co nowego – informacje o wydaniu"
!define MUI_FINISHPAGE_LINK_LOCATION "https://noreclient.pl"
!define MUI_FINISHPAGE_LINK_COLOR "C6A3FF"
