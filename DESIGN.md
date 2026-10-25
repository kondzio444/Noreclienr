---
name: Nore – Album
description: Everything a player owns in Nore is a sticker in their album. Black card pages, die-cut stickers with a white vinyl rim, ghost slots for what is missing, dot stickers for state.
colors:
  accent: "#9d5cff"
  accent-light: "#c6a3ff"
  accent-deep: "#6d38dc"
  page: "#141216"
  page-raised: "#1e1b21"
  page-raised-2: "#28242c"
  slot: "#0c0b0e"
  ghost: "#2e2a33"
  ink: "#f3efe9"
  ink-soft: "#b3abb0"
  ink-faint: "#837b82"
  vinyl: "#fbfaf7"
  vinyl-ink: "#17141a"
  vinyl-ink-soft: "#5d5560"
  paper: "#e8e5e0"
  cover: "color-mix(in oklab, var(--nore-accent) 18%, #0f0d12)"
  cover-tab: "color-mix(in oklab, var(--nore-accent) 26%, #18151c)"
  cover-ink: "#e9e2f5"
  cover-ink-soft: "#ab9fc0"
  dot-ready: "#3fd27f"
  dot-wait: "#ffd23a"
  dot-error: "#ff5a4f"
  dot-event: "#ff8a1f"
  dot-info: "#4aa3ff"
  dot-off: "#6c656d"
  halloween-page: "#0b0a0c"
  halloween-phosphor: "#d2ff7a"
  halloween-pumpkin: "#ff7417"
  winter-page: "#11141b"
  winter-frost: "#e9f4ff"
  winter-ice: "#8fd3ff"
typography:
  hero:
    fontFamily: "Dela Gothic One, Onest, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Dela Gothic One, Onest, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.13
    letterSpacing: "-0.01em"
  play:
    fontFamily: "Dela Gothic One, Onest, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.02em"
  section:
    fontFamily: "Onest, Segoe UI, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.33
  lead:
    fontFamily: "Onest, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Onest, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Onest, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.38
  meta:
    fontFamily: "Onest, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.33
  keycap:
    fontFamily: "Pixelify Sans, Onest, monospace"
    fontSize: "13px"
    fontWeight: 600
rounded:
  xs: "4px"
  sm: "8px"
  md: "12px"
  sticker: "16px"
  sheet: "18px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "14": "56px"
components:
  button-play:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    typography: "{typography.play}"
    rounded: "{rounded.pill}"
    padding: "0 40px 0 34px"
    height: "64px"
  button:
    backgroundColor: "{colors.page-raised-2}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "40px"
  button-sticker:
    backgroundColor: "{colors.accent-deep}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "40px"
  sticker:
    backgroundColor: "{colors.page-raised}"
    rounded: "{rounded.sticker}"
  label:
    backgroundColor: "{colors.vinyl}"
    textColor: "{colors.vinyl-ink}"
    rounded: "7px"
    padding: "0 10px"
    height: "24px"
  slot:
    backgroundColor: "{colors.slot}"
    rounded: "{rounded.sticker}"
  input:
    backgroundColor: "{colors.slot}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  sheet:
    backgroundColor: "{colors.page-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
  tab-active:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "11px 0 0 11px"
    height: "33px"
  clipping:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.vinyl-ink}"
    rounded: "3px"
    padding: "16px 18px"
---

# Design System: Nore – Album

The machine-readable source of every value below is `design/tokens.json`; `node design/build-tokens.mjs` writes `design/tokens.css` (all `--nore-*` custom properties) and `common/src/main/java/dev/noreclient/util/ThemeTokens.java`. When this file and the JSON disagree, the JSON wins and this file gets fixed. Mocks, PNGs, motion storyboards and per-surface checklists live in `design/` (start at `design/README.md`).

## 1. Concept

**Creative North Star: "Album"** – a collector's sticker album with black card pages.

**The one idea.** Everything a player owns in Nore is a sticker in their album: instances, modules, cosmetics, friends, servers, event items. Turning something on *sticks it* into its slot; turning it off *peels it* and leaves the printed ghost of where it goes. The whole product, from the website to the in-game module menu, is one album seen at different pages.

Why it belongs to Nore and no other launcher: Nore's heart is collecting and switching things on (97 modules, wardrobe capes, seasonal cosmetics that are always on, instances, a server list). Players of this age stick stickers on laptops, controllers and school folders; a Minecraft player's own world is made of placed blocks and collected items. A sticker album is that ritual made into an interface, and it gives every on/off state a physical, legible form.

What it refuses: the category default of glowing glass cards on a blurred wallpaper, purple gradients, neon edges; and the previous "server list / § codes" look, which is retired.

**Key characteristics**
- Black album card ground (`page` #141216) with a faint fibre grain. Dark is chosen by scene: an evening gaming desk lit by the monitor.
- The rail, the installer sidebar, the updater and the login gate are the album **cover**: bookcloth dyed with the user's accent.
- **Stickers**: flat at rest, a white vinyl rim (2/3/5 px), rounded die-cut corners, optionally tilted ±3°. They only cast a shadow while being peeled (hover, drag, the instant before sticking).
- **Ghost slots**: recessed `slot` wells with a dashed die line and the item's silhouette in `ghost` ink. Empty and "off" are designed as carefully as "on".
- **Dot stickers** carry state, one meaning each.
- **Washi tape** holds paper clippings (news). **Label stickers** carry loader, version, rank.
- One violet hero per view: the Graj sticker (or the page's single primary action).
- The metaphor is visual. Copy stays plain Polish: "Zainstalowano", not "Przyklejono".

## 2. Colour

Strategy: Restrained neutrals tinted warm-black, one accent (themable violet), a fixed four-colour state set, and full-field colour only where a surface earns it (website bands, event posters).

### Base (dark only; there is no light theme)
| Token | Value | Role |
|---|---|---|
| `page` | #141216 | Ground of every page. |
| `page-raised` | #1e1b21 | Loose sheet: settings groups, instance header, modals, menus. A tone step, no border. |
| `page-raised-2` | #28242c | Hover on a sheet, secondary (slot) buttons. |
| `slot` | #0c0b0e | Recessed: inputs, tracks, empty sticker places, code wells. |
| `ghost` | #2e2a33 | Printed silhouette and dashed die line inside empty slots. |
| `ink` / `ink-soft` / `ink-faint` | #f3efe9 / #b3abb0 / #837b82 | Text 16.3:1 / 8.3:1 / 4.5:1 on `page`. `ink-faint` only ≥13px. |
| `vinyl` | #fbfaf7 | Sticker rims; face of white stickers. |
| `vinyl-ink` / `vinyl-ink-soft` | #17141a / #5d5560 | Text on white stickers and paper (17.5:1 / 5.7:1). |
| `paper` | #e8e5e0 | Clippings and the login nameplate. |
| `cover` | color-mix(accent 18%, #0f0d12) | Album cover (rail etc.). Derived, never hard-coded; fallback #291c3d. |
| `cover-tab`, `cover-ink`, `cover-ink-soft` | derived, #e9e2f5, #ab9fc0 | Inactive tab hover, text on the cover (6.4:1). |
| `scrim` | rgba(8,7,10,.72) | Behind a modal. Flat, no blur. |

### Accent (brand commitment: violet stays, user-themable)
`accent` #9d5cff (runtime `--nore-accent`), `accent-light` #c6a3ff (links, accent text on dark, 8.9:1), `accent-deep` #6d38dc (fields that carry small white text, 6.5:1). **White on `accent` is 3.9:1: only large text (Graj at 24px Dela, display headings).** Small text on violet always sits on `accent-deep`. The logo is recoloured to the accent with `hue-rotate` (238° for the default).

### Dot stickers (state) – one meaning each
`dot-ready` #3fd27f ready, online, running, installed · `dot-wait` #ffd23a waiting, update available, beta, starting, pending invite · `dot-error` #ff5a4f error, crash, offline server · `dot-event` #ff8a1f events, seasonal items, countdowns · `dot-info` #4aa3ff information, LAN, docs · `dot-nore` = accent: Nore Client, Nore Hub · `dot-off` #6c656d offline, disabled, unknown. A dot always has a 2px vinyl rim (1 GUI px in game). Never use a dot colour for decoration.

### Label stickers
Loader fills with dark text: Fabric #e8c873, Quilt #d99be8, Forge/NeoForge #e09a5b, Vanilla #8fd18b, Modpack #7cc7d6; Nore Client = accent-deep with white; version = vinyl with dark text; dark label = page with ink.

### Tape, foil
Washi tape: lilac rgba(198,163,255,.78), mint rgba(150,228,196,.74), kraft rgba(214,190,150,.8). At most two strips per view. **Foil** (holographic conic of #c6a3ff → #9fe6ff → #c7ffd9 → #ffe9a3 → #ffc1e3) only on rare/seasonal cosmetic stickers, rotated by pointer position; never on resting website surfaces.

### Named rules
- **One violet hero.** One solid accent sticker per view (Graj, or the page's primary action). Everything else is page, sheet, slot, white sticker.
- **Dots mean.** A dot colour means its state or it is `dot-off`.
- **Derived cover.** Every cover/rail colour is computed from `--nore-accent`.

## 3. Typography

| Family | Source / licence | Use |
|---|---|---|
| **Dela Gothic One** (400) | Google Fonts, SIL OFL 1.1 | Display: wordmark, page titles, instance names, the Graj label, big figures, sticker letters. Never below 18px, never running text. Polish diacritics verified. |
| **Onest** (variable 100–900; use 400/500/600/700) | Google Fonts, SIL OFL 1.1 | Everything a player reads to work. `font-variant-numeric: tabular-nums` on every live number. |
| **Pixelify Sans** (400/600) | Google Fonts, SIL OFL 1.1 | Only keycaps (Prawy Shift, F5, Ctrl F) and in-game UI fragments shown on the web or launcher. |
| system mono (`ui-monospace, Cascadia Mono, Consolas`) | system | Real code/JSON only (API docs, console). |
| Minecraft default font | the game's own | All in-game text. |

Website loads the two web faces from Google Fonts (`display=swap`). The launcher and updater are offline and CSP `font-src 'self'`: download the OFL woff2 (latin + latin-ext subsets) into `launcher/src/renderer/assets/fonts/` with the OFL text beside them, replacing Archivo/Inter/Silkscreen. Never inline fonts as data URIs.

### Scales
**Launcher** (px, font/line): meta 12/16 Onest 500 · label 13/18 Onest 600 · body 14/21 Onest 400 · lead 16/24 Onest 600 · section 18/24 Onest 700 · title 30/34 Dela (-0.01em) · hero 44/46 Dela (-0.015em) · play 24 Dela (+0.02em, uppercase GRAJ).
**Website**: small 16px Onest 500 · body clamp(16px, 1.05vw + 12px, 19px)/1.55 · lead clamp(20px, 1.2vw + 14px, 28px)/1.35 · heading clamp(34px, 4.2vw, 64px)/1.0 Dela -0.02em · display clamp(64px, 12.5vw, 200px)/0.86 Dela -0.035em (hero uses up to 112px so the headline stays on two lines). Headlines ≤2 lines at every width.
**Game**: Minecraft font at integer scales only: 1x body (9px line), 2x titles, 3x hero numerals (clock).

### Rules
- Sentence case everywhere except GRAJ. No tracked uppercase kickers, no eyebrows.
- Dela is set tight and large or not at all; long Polish words get a smaller step, never letter-spacing.

## 4. Space, radii, elevation

- **Spacing** 4px base: 4, 8, 12, 16, 20, 24, 32, 40, 56, 80, 120, 160. Launcher shell: rail 224px, titlebar 36px, page padding 28px top / 32px sides, gaps 16px, groups 28px. Website margin clamp(16px, 2.2vw, 32px), section gap clamp(96px, 12vw, 200px), board gap 8px. Game: 2px unit, 8px padding, 4px gap, 12px screen edge (GUI px).
- **Radii**: xs 4 · sm 8 · md 12 (inputs, small stickers) · sticker 16 · sheet 18 · large hero sticker 22 · pill 999 (all buttons, segmented, switches). Game: 2 / 3 / 4 GUI px.
- **Rim**: 2px small labels and dots, 3px stickers and buttons, 5px hero objects (web 5–6px). Game 1 GUI px.
- **Elevation**: `flat` (page, slots, stickers at rest) → `lift` `0 10px 20px -8px rgba(0,0,0,.65), 0 2px 4px rgba(0,0,0,.35)` (sticker being peeled) → `float` `0 24px 48px -12px rgba(0,0,0,.7), 0 4px 10px rgba(0,0,0,.4)` (modals, menus, toasts, dropdowns, save bars). Surfaces separate by tone steps, not borders or glows. The only glow in the system is Halloween `phosphor`.

## 5. Components

- **Sticker** (`.sticker` in `design/mocks/kit.css`): vinyl rim, artwork inside, `--tilt`. Hover = lift 3px, tilt eases toward 0 by 40%, `lift` shadow, a peel corner (folded triangle showing the cream paper back) grows from 18 to 22px. Press = scale .97, no shadow. Variants: white (vinyl face, dark text), ink (page face), violet (large text only).
- **Die-cut contour** for transparent art (logo, heads, sprites): four `drop-shadow(±2px 0 0 vinyl)` filters in the launcher; pre-baked rim PNGs on the website and in game (`design/mocks/assets/*-sticker.png`, `logo-sticker-*.png`, `logo-rim-256.png`).
- **Ghost slot**: `slot` fill, 2px dashed `ghost` outline inset 7px, silhouette in `ghost`, name in `ink-faint`. Used for: module off, mod disabled, empty collection place, "Nowa instancja", offline server icon.
- **Graj sticker**: pill 64px (46px small), accent fill, 4px vinyl rim, Dela 24 white "GRAJ" with a filled play glyph. States in §7.
- **Buttons**: secondary = `page-raised-2` pill 40px Onest 600 14; sticker button = `accent-deep` pill with 3px rim; white = vinyl pill; quiet = pen link (2px accent-light underline, offset 4px).
- **Inputs**: `slot` well, 12px radius, 44px, no border; focus = 2px accent ring. Caret accent-light.
- **Switch**: a dot sticker on a slot track: off = grey dot left, on = accent dot right on a 34% accent track; knob travels on `spring.knob`.
- **Slider**: 10px slot track, accent fill (exact length of the value), white dot thumb with accent centre; value shown in a label sticker.
- **Segmented**: slot track, chosen option is a white sticker pill that travels on `spring.tab`.
- **Index tabs (nav)**: on the cover; inactive tabs are cover-ink at 82%; the active tab is a piece of page pulled out over the cover, joined with 12px concave corners; its icon turns accent-light. Group labels sentence case 12px cover-ink-soft. Count = plain number; state = dot.
- **Label sticker**: 24px (20 small), 7px radius, 2px rim. Loader, version, RAM, Java, rank.
- **Clipping**: paper card, 3px radius, tilted ±1.2°, one washi tape strip. News only.
- **Toast**: white sticker slapped bottom-right (tilt -1°), dot + two lines, `float` shadow.
- **Sheet / modal**: `page-raised`, 18px radius, `float`; scrim flat.
- **Nameplate** (login): paper label "Ten album należy do" with the nick written on a 2px ink rule in Dela 44.

## 6. Iconography and illustration

- **Icons**: Lucide geometry (ISC), 24 grid, 1.9 stroke, round caps and joins, 17–18px in the launcher, 18px on the web. In game: the existing pixel glyph font `assets/noreclient/font/icons.json` (9px grid), drawn in the text colour.
- **Illustration**: pixel stickers authored as string grids (`design/mocks/assets/make-sprites.py`) so launcher, website and game draw the same sprite: pumpkin, bat, ghost (phosphor), spider, witch hat, candy, snowflake, gift; heads are 8×8 faces. Rendered nearest-neighbour, always with a vinyl rim.
- **Photography**: only real game imagery (panoramas `assets/noreclient/panorama/cherry_*`, `web/public/assets/home/*`) inside stickers. No stock, no gradients standing in for pictures.
- **Texture**: page fibre grain (SVG turbulence tile, ~9% light specks); cover bookcloth (two stretched turbulence passes). Both static; never animated.

## 7. Motion

All values are tokens (`--nore-dur-*`, `--nore-ease-*`, `--nore-spring-*`, `--nore-stagger`, `--nore-shift-*`). Springs are generated into CSS `linear()` curves by the build script and exported as {stiffness, damping, mass} to Java.

| Token | Value | Use |
|---|---|---|
| `dur.tap` | 90ms | press |
| `dur.quick` | 140ms | hover, colour, state |
| `dur.base` | 220ms | routine, value swaps, rub sweep |
| `dur.exit` | 160ms | anything leaving (always shorter than it came) |
| `dur.peel` | 260ms | sticker peeling off |
| `dur.overlay` | 280ms | sheet/menu/toast arriving |
| `dur.page` | 320ms | page turn |
| `dur.stick` | 380ms (spring settles ~445ms) | sticker slapping in |
| `dur.launch` | 900ms | app launch storyboard |
| `dur.reveal` | 1400ms | event reveal |
| `dur.ambient` | 9000ms | slow loops (torch sway, snow) |
| `ease.out` | cubic-bezier(.22,1,.36,1) | arrivals |
| `ease.in` | cubic-bezier(.55,0,1,.45) | departures |
| `ease.in-out` | cubic-bezier(.65,0,.35,1) | loops, swaps |
| `ease.peel` | cubic-bezier(.45,0,.2,1) | corner lift then release |
| `ease.rub` | cubic-bezier(.3,0,.1,1) | rub-down highlight |
| `spring.stick` | k700 c30 m1 (~11% overshoot) | sticker into slot |
| `spring.tab` | k430 c32 m1 (~3%) | active tab, segmented pill |
| `spring.knob` | k520 c26 m1 | switch knob |
| `spring.soft` | k180 c22 m1 | album cover opening, event poster |
| `stagger` | 45ms, max 8 | list/grid entrances (~360ms cap) |
| shifts | lift 3, press 1, page 28 in / 14 out, drop 10, stick scale 1.12, stick tilt +4°, resting tilt ±3° | |

**Micro-interactions**: *Stick* (scale 1.12 → 1, tilt +4° → own tilt, opacity 0 → 1 by 40%, `lift` shadow → none, `spring.stick`). *Peel* (corner lifts 3°, 4px up with `lift` shadow over 35%, then flies 18px up-right +8° and fades; `dur.peel`, `ease.peel`). *Rub* (after a press, a pale band sweeps once across the sticker in `dur.base`, `ease.rub`). *Dot slap* (scale 1.6 → .92 → 1). *Lift* on hover. Values count up with tabular figures. Progress fills are exact lengths (scaleX), never decorative.

**Page and scene transitions** (launcher): the outgoing page drops 14px left and fades in `dur.exit`/`ease.in`; the incoming page arrives 28px from the right in `dur.page`/`ease.out` and its stickers stick in with the stagger. Moving *up* the tab list mirrors the direction. Detail pages (instance, server) arrive from the right and leave back to the left. A second click mid-transition starts the next one immediately. The active tab travels on `spring.tab`.

**Reduced motion** (`prefers-reduced-motion` or the in-app "Animacje: Wyłączone"; "Oszczędne" keeps fades only): all shifts and tilt animation become 0, springs become `ease.out` at 140ms, durations cap at 200ms, no ambient loops (torch sway, snow, foil, drift, bats), event reveals become a 200ms crossfade. Colour and opacity changes stay so state remains readable. Content is visible by default; entrances use `backwards` fill only.

Storyboards for app launch, page change, the Graj sequence and event reveals: `design/README.md` § Motion storyboards.

## 8. Surfaces

### Website (noroclient.pl) – Persuade; /api – Read; /panel – Operate
Direction dealt by the taste skill: "Dressed as something else" (borrowed category: a sticker album / sticker drop), counter-object hero. Mocks: `design/mocks/web-home.html`, `web-api.html`, `web-panel.html`.
- **Home**: plain bar (logo sticker + "Nore", five links, one "Pobierz" pill). Hero: one object on the counter: a 4:5 die-cut sticker (26vw) holding real product screens that slowly crossfade (in-game menu → Szatnia → launcher, 6s each), with the logo sticker, a pumpkin sticker and an event label stuck on its corners; below it "Minecraft po swojemu." in Dela on two lines, then one row: versions · download pill · "Za darmo · premium albo sam nick". Second screen: full-bleed violet field with a two-line headline interrupted by letter-height screenshot stickers. Inner sections: a board of flat tiles, each an enlarged real UI fragment (`data-ui`) cropped by two edges; the updater clip (`web/public/assets/api/updater.webm`) is the page's moving picture. The live thing (from today's site): type your nick and get it back as a name sticker with your head.
- Taste-skill house rules apply: two faces, no rules/gradients/eyebrows/mono outside code, shadows only on floating things, pill buttons, ≥4 real pictures, every section has an entrance. Run with `--allow palette-purple` (violet is a brand commitment). Body ≥16px; small text on violet sits on `accent-deep`.
- **API docs**: left index as pills (method label sticker + path), endpoint heading in code type, parameter table (lines allowed in real tables), "Zapytaj na żywo" panel (`data-ui`) with response status as dots and a rendered preview of what the launcher shows.
- **Bot panel**: the launcher's grammar on the web: cover rail with index tabs (modules with on/off dots), form fields rendered from the bot schema (channel select, textarea with variable label stickers, colour dot swatches, role chips, switch), a Discord preview, recent events with dots, and a white floating save bar ("Masz N niezapisane zmiany · Cofnij · Zapisz"); 409 conflict and schema errors appear as a red-dot line under the field (JSON pointer mapped to the field).

### Nore MC (mc.noreclient.pl) – the partner server, same family
Mock: `design/mocks/web-server.html`. The server's signature object is the **address label**: `mc.noreclient.pl` printed on a white die-cut sticker that copies itself on click (toast "Skopiowano adres"). Hero: "Nore MC" in Dela, live status row (dot, players, version, ping, read from `/api/v2/servers/mc.noreclient.pl`), "Graj przez Nore Launcher" (deep link) and the rules; a tilted spawn-screenshot sticker with player heads stuck on it. Sections: three ways to join (launcher path stickers, the pinned server in the client's list, plain address), ranks as a sticker sheet (each rank its own die-cut shape and colour; Gracz free, paid ranks on `accent-deep` and `dot-wait`), then rules, vote, staff (head stickers with role labels), news (clippings) and Discord. Prices, perks, ping and player counts in the mock are **sample content**.
- **In game**: Multiplayer pins the official server above the player's list as an `accent-deep` sticker with a vinyl "oficjalny" label, live players and a white "Dołącz" pill (`design/mocks/game-multiplayer.html`). It cannot be deleted, only collapsed.
- **Launcher**: Start features it as a violet sticker card "Nore MC · oficjalny serwer" with live count and Dołącz (`launcher-home.html`); the Serwery page lists it first. During events this card yields its place to the event poster.

### Launcher – Operate
Mocks: `launcher-home.html`, `launcher-instance.html`, `launcher-settings.html`, `launcher-login.html`, `launcher-home-halloween.html` (1280×800). Shell: cover rail (224px) with index tabs and the account chip at the foot; page with a 36px titlebar (status dot left, window controls right). **Start**: the current instance as a 272px hero sticker tilted -3° with loader/version labels stuck on it; name in Dela 44; meta line (play time, last played, mods); label stickers; Graj + Zmień + folder; a ready line with a dot. Below: recent instances in slots ending with a ghost "Nowa instancja"; "Twoja kolekcja" (cosmetics as small stickers with acquisition dates, ghost slots for the coming series, a count). Right: featured server or event poster, taped news clippings, friends as round head stickers with dots. **Instance**: header sheet with the hero sticker small, segmented tabs, mods as rows with a mod sticker + switch (disabled mod → ghost), worlds as photo stickers, facts sheet. **Settings**: sheets in two columns; accent swatches are dot stickers (chosen one bigger with a check) with a live Graj preview; "Animacje: Pełne / Oszczędne / Wyłączone". **Login**: the closed album cover with a blind-debossed "Nore", the logo sticker, the nameplate for the nick (non-premium, always available, primary), and a Microsoft device-code sheet whose code is eight letter stickers.

### Installer + Updater
- **NSIS** (`installer.html`, 497×390): Windows chrome and system buttons stay Windows; `MUI_BGCOLOR 141216`, `MUI_TEXTCOLOR F3EFE9`. The 164×314 sidebar bitmap is the cover: bookcloth, the logo sticker tilted -6°, "Nore Launcher" in Dela 22, a version label sticker, three dots + noroclient.pl. The 150×57 header bitmap: cloth, version label, small logo sticker. Progress bar: remove its theme (`UxTheme::SetWindowTheme` with empty strings) then `PBM_SETBARCOLOR` accent and `PBM_SETBKCOLOR` slot. `installer-art.py` regenerates the bitmaps from the tokens (Dela/Onest TTF fetched at build time, not committed).
- **Nore Updater** (`updater.html`, 400×480 frameless): the cover with a **sticker pack** (crimped foil sachet, page black, vinyl outline, tilted -3°) showing the logo sticker, "Nore Launcher" and the new version label. The pack's **tear strip is the progress bar**: the torn part (accent) curls up and follows the download; at 100% and a verified SHA-256 the pack opens and the new version sticker sticks out (`spring.soft`) with "Witaj w X" and up to three notes. Status line with a dot (wait → ready, error = red dot + "Spróbuj ponownie"), MB and speed in tabular figures, the current version as a dark label in the footer.

### In-game client – Nore Client (`Theme`, `ThemeTokens`, `Render2D`, `gui/**`)
Mocks: `game-main-menu.html`, `game-clickgui.html`, `game-pause.html`, `game-multiplayer.html`, `game-main-menu-halloween.html`, drawn at 533×300 GUI px and rendered at GUI scale 3 (1600×900).
- **Scale**: every value in GUI pixels; layouts must also hold at GUI scale 2 and 4. No fractional text scales: `g.scale(2)` for titles, `3` for the clock.
- **Text**: Minecraft's own font. Text shadow only over the world; never on sheets or stickers. The mocks use Pixelify Sans as a visual stand-in.
- **What Render2D draws**: sheets = `roundedRect` with `PAGE` (92% alpha) or `RAISED`; stickers = `roundedRect` VINYL 1px larger behind the face (the rim); slots = `roundedRect` SLOT + dashed die line as 2-px `rect` dashes along the edges; dots = `circle` vinyl r+1 then colour; peel corner = two `TRIANGLES` via `mesh`; tape = a skewed quad via `mesh` (`TAPE_*`); lift shadow = `shadow()` with `LIFT`; flashlight = `radial()`; logo = `texture` (bake `logo-sticker` and `logo-rim` textures from `design/mocks/assets`, accent recolour stays on the logo layer). Gfx has no rotation: **in-game stickers never tilt** (tape quads may be skewed).
- **Main menu**: left album sheet (spine strip in `cover`), logo sticker + "NORE" 2x + version, menu items as rows where the hovered one becomes a white sticker with a peel corner, quit in soft red; right side: clock on a dark label, a taped "Nowe w X" clipping, quick-join to Nore MC, friends' heads. **ClickGUI**: one sheet with a cover column of index tabs (categories + collections) and a 4-column grid where an enabled module is a white sticker (accent icon, dark name, category, keycap) and a disabled one is a ghost slot; hovering a ghost shows the sticker at 50% lifted ("LPM włącz · PPM ustawienia"); toggling sticks or peels. **Pause**: violet "Wróć do gry" pill on top, the same rows, a session clipping, friends, today's screenshots as stickers, keycaps for F2 / P.Shift / Esc.
- **Motion in game**: add a `Spring` next to `Animation` using `ThemeTokens.SPRING_*` (dt capped 0.05s); screen open = sheet slides 6 GUI px + stagger 45ms per sticker (max 8); toggles use stick/peel; respect `ClientSettings` animation option (off = instant).
- **Sounds**: stick = short soft "pap" (UI click pitched down, 0.6 volume), peel = paper rip (very short), page = page flip; all behind `Theme.sounds()`.

## 9. Events (forced on; cannot be disabled)

### Halloween 2026 – "Zgaszone światło" (lights out), 15 Oct – 3 Nov
- **Palette shift** (`[data-event=halloween]`): page #0b0a0c, raised #151317, slot #060507, cover = 9% accent into #070609, ink #e9e4dc, ink-soft raised to #b8b0b6 so secondary text keeps 4.5:1. New: `phosphor` #d2ff7a (glow-in-the-dark stickers, the only glowing colour in the system), `pumpkin` #ff7417 (event tab, poster title, Łap dynie), torch rgba(255,236,196,.16). Accent and Graj stay the user's colour.
- **Motifs**: glow-in-the-dark stickers (ghost, the three capes Dynia / Nietoperz / Pajęczyna), pixel pumpkins whose faces flicker like candles, bats, a spider on a thread, a phosphor cobweb in a page corner, an event poster taped with kraft tape.
- **The torch**: the pointer carries a warm flashlight cone over the page background. Non-text art (sticker artwork, clippings) dims to `brightness(.58–.7)` with distance from the torch, then returns to full near it; text and controls never dim. Glow stickers **charge**: passing the torch over one makes it glow brighter for ~4s, then it fades back to its resting glow. The mini-game "Łap dynie" lives on the Halloween page.
- **Particles**: 2–3 bats on slow figure-eight paths (existing `HalloweenDecor` flights), dust motes inside the torch cone (launcher only, ≤12).
- **Sound cues**: on reveal, a light-switch click and a low room hum fading out in 1.2s; candle flicker crackle on pumpkin hover (launcher Halloween page only).
- **Reach**: website = poster label on the hero object + one tile; launcher = full palette + torch + poster + glow collection; game = main menu lights out (night panorama, torch radial around the cursor, glowing pumpkins, bats, ghost sticker on the logo, event poster instead of the news clipping), ClickGUI and pause only swap the clipping tape to kraft and add the countdown dot; installer/updater: none.

### Winter – "Seria zimowa", from 10 December 2026
- **Palette shift** (`[data-event=winter]`): page #11141b, raised #1a1e27, slot #0a0c11, cover = 14% accent into #0d1220. New: `frost` #e9f4ff, `ice` #8fd3ff, string-light dots red #ff5a5a, green #5be38f, gold #ffd257, blue #6cb8ff.
- **Motifs**: frost creeping from the page corners (static after the reveal), holographic **foil** winter stickers (snowflake, gift), a string of light dot stickers along the titlebar that twinkle in steps, snow made of hole-punch confetti (paper circles from the album's own puncher) falling slowly.
- **Particles**: confetti snow ≤40 flakes in the launcher, ≤60 in the game menu, 0 under reduced motion.
- **Sound cues**: on reveal a soft crackle of frost and one small bell; none afterwards.
- **Reach**: same as Halloween (website label + tile, full launcher, game main menu, light touches elsewhere).

## 10. Do and don't

**Do**: route every accent use through `--nore-accent` / `Theme.accent()`; give every live object one of the state dots; design the ghost slot of anything that can be off or empty; keep one violet hero per view; use exact-length bars; date acquisitions in the collection; keep copy plain.

**Don't**: glass, backdrop blur, glows (outside Halloween phosphor), gradient text or gradient fields; borders as separators between surfaces (tone steps instead); tilted stickers in long lists or in game; more than three tilted objects per view; small white text on `accent`; pixel font outside keycaps and game fragments; the old § codes, rank brackets and server-list styling.
