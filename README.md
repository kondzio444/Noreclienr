# Nore Client + Nore Launcher

Własny **launcher Minecraft** (instalator `.exe`) i **klient PvP/QoL** dla Minecraft 1.21.1 (Fabric),
w ciemnym, pomarańczowym stylu z poświatą — jak Lunar Client, Feather czy LabyMod.

![Launcher](docs/screenshots/launcher-home.png)

## Nore Launcher

| Mody z Modrinth | Instancje |
|---|---|
| ![Mody](docs/screenshots/launcher-mods.png) | ![Instancje](docs/screenshots/launcher-instances.png) |
| **Konta premium i non-premium** | **Ustawienia** |
| ![Konta](docs/screenshots/launcher-accounts.png) | ![Ustawienia](docs/screenshots/launcher-settings.png) |
| **Kreator pierwszego uruchomienia** | **Animowana instalacja gry** |
| ![Kreator](docs/screenshots/launcher-wizard.png) | ![Instalacja](docs/screenshots/launcher-install.png) |

**Możliwości**
- **Wszystkie wersje Minecraft** (wydania i snapshoty) – pliki pobierane prosto z serwerów Mojang z weryfikacją SHA-1,
  wiele plików naraz (regulowane), praca offline po pobraniu.
- **Fabric** dla dowolnej wspieranej wersji, **Nore Client + Fabric API** instalowane automatycznie dla 1.21.1.
- **Java dobierana automatycznie** (oficjalne środowiska Mojang) albo własna ścieżka.
- **Instancje** – osobne foldery z modami, światami i ustawieniami; kolor, RAM per instancja, auto-dołączanie do serwera, czas gry.
- **Przeglądarka Modrinth**: mody (z zależnościami), paczki zasobów, shadery i datapacki (instalowane do wybranego świata);
  zakładka „Zainstalowane” z włączaniem/wyłączaniem i usuwaniem.
- **Konta**: Microsoft/premium (logowanie kodem urządzenia, odświeżanie sesji, tokeny szyfrowane systemowo)
  oraz non-premium (dowolny nick).
- **Konsola** z logami gry na żywo, zatrzymywanie gry, ukrywanie launchera po starcie.
- **Wygląd**: animowane tło (zdjęcie JWST z efektem Ken Burns i paralaksą), unoszące się iskry, przyciski z poświatą,
  płynne przejścia stron, kaskadowe animacje kart, przesuwany wskaźnik w menu, ekran startowy, powiadomienia.

### Instalator `.exe`

| Powitanie | Zakończenie |
|---|---|
| ![Instalator](docs/screenshots/installer-welcome.png) | ![Koniec](docs/screenshots/installer-finish.png) |

Polski instalator z własną grafiką: wybór folderu i użytkownika, licencja, skróty na pulpicie i w menu Start,
uruchomienie po instalacji, deinstalator. Po pierwszym starcie launcher prowadzi przez animowany kreator:
konto → RAM → instalacja gry z pierścieniem postępu.

### Budowanie launchera

```bash
./gradlew build                 # najpierw mod (trafi do instalatora)
cd launcher
npm install
npm start                       # uruchomienie w trybie deweloperskim
npm test                        # testy rdzenia
npm run dist:win                # instalator Windows -> launcher/dist/NoreLauncher-Setup-1.0.0.exe
npm run dist:linux              # AppImage
npm run dist:mac                # DMG (na macOS)
```

Na Linuksie do budowania `.exe` potrzebny jest Wine (`wine64` + `wine32`). Najprościej użyć GitHub Actions —
workflow `.github/workflows/build.yml` buduje mod oraz instalatory Windows/Linux/macOS przy każdym pushu
(pliki w zakładce *Actions → Artifacts*).

### Logowanie Microsoft (premium)

Mojang wymaga, aby każdy launcher miał własną aplikację Azure zatwierdzoną do Minecraft API:
1. Zarejestruj aplikację na [portal.azure.com](https://portal.azure.com) (typ kont: *osobiste konta Microsoft*, włącz *public client flows*).
2. Złóż wniosek o dostęp do Minecraft API (formularz Mojang „Minecraft API access”).
3. Wpisz *Application (client) ID* w launcherze: **Ustawienia → Konta Microsoft**.

Do tego czasu można grać na koncie non-premium (singleplayer, LAN, serwery z `online-mode=false`).

## Nore Client (mod)

| Menu główne | Menu modułów |
|---|---|
| ![Menu](docs/screenshots/client-main-menu.png) | ![Moduły](docs/screenshots/client-modules.png) |
| **Pobieraj w grze (Modrinth)** | **Menu pauzy** |
| ![Pobieraj](docs/screenshots/client-downloads.png) | ![Pauza](docs/screenshots/client-pause.png) |

- **Styl**: pomarańczowy motyw, wszystkie przyciski z poświatą („glow outline”), logo w menu, animacje wejścia,
  własne menu główne i menu pauzy (Powrót do gry, Moduły, Edytor HUD, Postępy, Statystyki, Ustawienia, LAN, Wyjdź).
- **Pobieraj w grze** (`Prawy Shift` → *Pobieraj*): paczki zasobów (włączane jednym kliknięciem), mody, datapacki
  do aktualnego świata i shadery prosto z Modrinth, z ikonami i sortowaniem.
- **Menu modułów**: kategorie, wyszukiwarka, przełączniki, suwaki, wybór trybów, color picker z trybem tęczy, przypisywanie klawiszy, profile.
- **Edytor HUD** (`H`): przeciąganie, przyciąganie do linii pomocniczych, skalowanie, panel elementów.
- **Moduły**: 17 nakładek HUD (FPS, CPS, Keystrokes, Coordinates, Armor Status, Potion Effects, Target HUD, Compass,
  Combo, Reach…), Zoom (`C`), Freelook (`Lewy Alt`), własny celownik, Fullbright (`B`), Toggle Sprint, Time Changer,
  Low Fire, No Hurt Cam, Clear Weather, Chat Timestamps, Hide Scoreboard.

Wszystkie funkcje działają tylko po stronie klienta – bez cheatów.

## Struktura

```
src/main/java/dev/noreclient/   – mod (Fabric 1.21.1)
launcher/src/main/              – proces główny launchera (pobieranie, Java, konta, uruchamianie, Modrinth)
launcher/src/renderer/          – interfejs launchera (HTML/CSS/JS)
launcher/build/                 – grafiki i konfiguracja instalatora NSIS
branding/                       – logo (pomarańczowe + oryginalne niebieskie), ikona .ico
```

## Licencje

Kod: Apache-2.0. Tło: „Cosmic Cliffs”, NASA/ESA/CSA/STScI (domena publiczna). Czcionki Inter i Outfit: SIL OFL 1.1.
Minecraft jest znakiem towarowym Mojang; projekt nie jest z nim powiązany. Do gry potrzebna jest licencja Minecraft: Java Edition.
