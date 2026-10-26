# Nore "Album" – implementer guide

The direction is in `/DESIGN.md`. This folder holds what you build from:

| Path | What |
|---|---|
| `tokens.json` | The single source of every colour, type step, space, radius, rim, shadow and motion value. |
| `build-tokens.mjs` | `node design/build-tokens.mjs` writes `tokens.css` and `common/src/main/java/dev/noreclient/util/ThemeTokens.java`; `--check` fails when they are stale (put it in CI). Prints the key contrast ratios. |
| `tokens.css` | Generated `--nore-*` custom properties, event overrides (`[data-event="halloween"|"winter"]`), reduced-motion overrides and `.no-anim`. Do not edit. |
| `mocks/*.html` | High-fidelity mocks. `kit.css` (stickers, slots, dots, labels, buttons, fields, tape, keyframes) is the reference implementation of the components; `launcher.css`, `web.css`, `game.css` are the shells. |
| `mocks/png/` | Rendered mocks. `node design/mocks/render.cjs [filter]` re-renders (Playwright Chromium, network for Google Fonts). |
| `mocks/assets/` | Authored pixel stickers and heads (`make-sprites.py`, synthetic), baked logo stickers (from `web/public/assets/logo.png`), cape crops (from `web/public/assets/home/halloween.webp`). |

Mock PNGs: `web-home-1440/390`, `web-api-1440/390`, `web-panel-1440/390`, `web-server-1440/390`, `launcher-home`, `launcher-instance`, `launcher-settings`, `launcher-login`, `launcher-home-halloween`, `installer-welcome`, `installer-progress`, `updater`, `game-main-menu`, `game-clickgui`, `game-pause`, `game-multiplayer`, `game-main-menu-halloween`.

Sample content to replace before shipping: instance names and stats, friends (ola_mc, bartek07, Mila – heads are drawn, not real skins), mod versions, Nore MC player counts, ping, rank prices and perks, Discord guild data, the example server `mc.przyklad.pl`.

## How each surface consumes the tokens

- **Website** (`web/public`): copy `design/tokens.css` into the deploy (or import it) and build pages from `web.css` + the mocks. Fonts from Google Fonts (`display=swap`). Gate: `node .claude/skills/taste-skill/scripts/lint.mjs web/public` and `CHROME_PATH=<chromium with --no-sandbox wrapper> node .claude/skills/taste-skill/scripts/inspect.mjs web/public/index.html --allow palette-purple`; 0 FAIL. The home mock passes both (2 WARN: paper reads as cream, size count).
- **Launcher** (`launcher/src/renderer`): replace the `:root` block in `styles.css` with an import of the generated tokens (copy to `launcher/src/renderer/tokens.css` in a build step). The runtime accent sets `--nore-accent` only; everything else derives. Self-host Dela Gothic One, Onest, Pixelify Sans woff2 (latin + latin-ext) with OFL.txt; remove Archivo/Inter/Silkscreen. Port `kit.css` component by component, keep every JS-generated class name (rename visuals, not hooks).
- **Updater / installer**: updater.css imports the same tokens (the updater runs before settings load: default accent inline is allowed there only). `installer-art.py` reads `design/tokens.json` for colours and draws the cover bitmaps; NSIS defines `MUI_BGCOLOR 141216`, `MUI_TEXTCOLOR F3EFE9`.
- **Game**: `Theme` keeps `accent()`/`accent2()`/`radius()` but its constants become aliases of `ThemeTokens` (`BG → PAGE`, `PANEL → RAISED`, `CARD → RAISED`, `OUTLINE` → removed, `TEXT → INK`, `TEXT_DIM → INK_SOFT`, `TEXT_MUTED → INK_FAINT`, `SUCCESS → DOT_READY`, `ERROR → DOT_ERROR`, `WARNING → DOT_WAIT`). Add `Render2D.sticker(g,x,y,w,h,face)`, `slot(...)`, `dot(...)`, `peel(...)`, `tape(...)` helpers (descriptions in DESIGN.md §8) and a `Spring` class fed by `ThemeTokens.SPRING_*`.

## Motion storyboards

Times are from the trigger. All of this collapses to a 200ms crossfade under reduced motion or "Animacje: Wyłączone"; "Oszczędne" keeps fades and drops travel.

**App launch (launcher, `dur.launch` 900ms)**
- 0ms: the window paints the cover (bookcloth, accent-dyed) full-size; logo sticker at centre at scale 1.12, tilt +4°, opacity 0.
- 0–240ms: the logo sticks (`spring.stick`) with a soft "pap".
- 240–560ms: the cover slides left and narrows into the 224px rail (`spring.soft`; transform only: the rail is in place, a full-width cover overlay scales X from its left edge); the black page is revealed underneath.
- 420–860ms: the page sticks in: hero instance sticker (stick), name fades up 8px, label stickers stick with 45ms stagger, then the Graj sticker slaps last at ~820ms with a rub sweep. Tabs appear with the rail, no stagger.
- If an event is active, the event reveal follows at 900ms (below), not before.

**Page change (launcher, `dur.page` 320ms)**
- Click a tab: the active tab piece travels to the new tab on `spring.tab` (~460ms settle, interruptible).
- Outgoing page: 14px left + fade, 160ms `ease.in`, inert at once.
- Incoming page: from 28px right + fade, 320ms `ease.out`; its stickers stick in staggered 45ms (max 8); lists refreshed in place do not replay.
- Upward in the tab order mirrors left/right. Instance/server detail: in from the right; Back: out to the right, list returns from the left. A click mid-transition starts the next transition from the current frame.

**Play button sequence (Graj)**
1. Hover: lift 3px, `lift` shadow, peel corner appears (140ms).
2. Press: flatten (scale .97, no shadow, 90ms), release: rub sweep (220ms), "pap".
3. Preparing: label swaps to the percentage (out 7px up, in from 7px below, 140ms); an `accent-deep` layer fills left→right as the exact download fraction (scaleX); a yellow dot slaps onto the sticker's top-right corner.
4. Launching: label "URUCHAMIANIE"; the peel corner lifts and settles twice (2 × 600ms, `ease.peel`) as the waiting signal.
5. In game: the yellow dot is replaced by a green dot slap; the sticker turns `page-raised-2` with label "W GRZE" (or "ZATRZYMAJ" on hover); launcher hides per setting.
6. Error: red dot slap, 3 × 2px horizontal shake (60ms each), label "SPRÓBUJ PONOWNIE", toast with the reason.

**Toggle (module, mod, cosmetic, setting)**
- On: the sticker sticks into its slot (`spring.stick`, from scale 1.12, +4°, `lift` shadow → none), sound "pap". In game: 1 GUI px lift settle, no rotation.
- Off: peel (corner lifts, sticker flies 18px up-right +8° and fades in 260ms) revealing the ghost slot, which was always there underneath.

**Event reveal – Halloween (first open during the event, and every visit to the Halloween page; `dur.reveal` 1400ms)**
- 0–260ms: the page dims in two flickers (to 35%, back to 90%, to 20%) like a failing bulb; light-switch click at 0.
- 260–700ms: palette crossfades to the Halloween tokens; the room hum starts.
- 700–1200ms: glow stickers fade in from 0 to their phosphor halo (stagger 60ms), the cobweb draws in (stroke-dashoffset), the spider drops on its thread (`spring.soft`).
- 1200–1400ms: the torch cone fades in at the pointer; bats begin their flights. From then on: torch follows the pointer (lerp 0.18 per frame), charged glow decays over 4s.
- Game main menu: same order, compressed to 900ms, drawn with `radial()` and the existing bat flights.

**Event reveal – Winter (10 December onward)**
- 0–600ms: frost grows from the four page corners (mask scale from the corner, `ease.out`), crackle.
- 400–1000ms: light dots along the titlebar switch on one by one (60ms steps), bell at the last one.
- 800–1400ms: confetti snow starts at low density and ramps to its count over 2s; winter foil stickers get a single foil sweep.

## Checklists

**Website**
- [ ] `tokens.css` imported; no literal colours in page CSS except data-ui fragments.
- [ ] Two faces (Dela Gothic One, Onest); Pixelify only inside `data-ui` fragments; mono only in `<pre>/<code>`.
- [ ] Hero = counter object + two-line Dela headline + one row with the download pill; headlines ≤2 lines at 1440/768/390.
- [ ] Buttons are pills with a 3px vinyl rim; small text on violet sits on `accent-deep`.
- [ ] ≥4 real pictures (product screens, panoramas, wardrobe renders); one moving picture (updater clip).
- [ ] Every section has an entrance (rise 24px, 640ms, staggered parts); reduced-motion fallback; nothing hidden without JS.
- [ ] The live nick sticker works on a phone and has a no-JS fallback.
- [ ] taste-skill lint 0 FAIL, inspect 0 FAIL with `--allow palette-purple`; impeccable detect run once.
- [ ] API docs and bot panel use the same tokens; panel fields render only from the bot schema; conflicts (409) and schema errors map to fields.
- [ ] Nore MC site: the address label copies, live status from `/api/v2/servers/mc.noreclient.pl`, sample prices replaced by real ones.

**Launcher**
- [ ] `:root` replaced by generated tokens; accent changes only `--nore-accent`; cover, tabs, logo hue derive from it.
- [ ] Fonts self-hosted (OFL); CSP unchanged.
- [ ] Rail = cover + index tabs with concave join; active tab travels on `spring.tab`.
- [ ] Stickers flat at rest; shadows only on lift and floating layers; ≤3 tilted objects per view; no tilt in lists.
- [ ] Every on/off object has its ghost slot; every live object has a state dot.
- [ ] Graj sequence implemented as storyboarded, interruptible, with exact progress.
- [ ] Page transitions directional; `.no-anim` and reduced motion honoured.
- [ ] Login: nick nameplate is primary and always available; Microsoft code as letter stickers.
- [ ] Nore MC featured on Start and first on Serwery; event poster takes the slot during events.
- [ ] Halloween/winter via `body[data-event]` only; no event styling inside base components.

**Installer + Updater**
- [ ] `installer-art.py` reads `design/tokens.json`; sidebar 164×314 and header 150×57 regenerated (cover, logo sticker, version label).
- [ ] `MUI_BGCOLOR 141216`, `MUI_TEXTCOLOR F3EFE9`, link colour C6A3FF; progress bar unthemed + accent.
- [ ] Updater: pack with tear-strip progress, verify → open → version sticker; error state with red dot and retry; reduced motion = static pack with a plain bar.

**In-game client**
- [ ] `ThemeTokens` generated, `Theme` constants alias it; no new literal colours in `gui/**`.
- [ ] Render2D helpers: sticker, slot (dashed), dot, peel corner, tape quad, lift shadow.
- [ ] Minecraft font only; integer scales; no text shadow on sheets.
- [ ] Main menu, ClickGUI (stickers vs ghost slots, cover tab column), pause, multiplayer with pinned Nore MC match the mocks at GUI scale 2, 3 and 4.
- [ ] `Spring` class; stick/peel toggles; stagger ≤8; respects the client's animation setting.
- [ ] Sounds behind `Theme.sounds()`.
- [ ] Halloween main menu: night panorama, torch radial, glowing pumpkins and ghost, bats, poster; winter: confetti snow, light dots, frost corners.

**Events**
- [ ] Forced on by date (Halloween 15.10–3.11, winter from 10.12); no switch anywhere.
- [ ] Event colours only from the event tokens; accent unchanged.
- [ ] Text never dims under the torch; secondary text keeps 4.5:1 in lights-out.
- [ ] Reveal storyboards implemented; reduced motion = crossfade, no particles.
