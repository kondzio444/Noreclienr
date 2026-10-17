---
name: Nore Launcher
description: A Minecraft launcher that speaks the server list's language. Tooltip violet-black, § colour codes for state, rank tags for status.
colors:
  accent: "#9d5cff"
  accent-light: "#c8a8ff"
  accent-deep: "#6a2fe0"
  rail: "color-mix(in oklab, #9d5cff 13%, #0a0610)"
  ground: "#0d0913"
  surface: "#150f1e"
  surface-raised: "#1c1428"
  overlay: "#120c1a"
  well: "#0a0710"
  keyline: "rgba(190, 160, 255, .13)"
  text: "#f3eefa"
  text-dim: "#b8adc9"
  text-muted: "#8f84a3"
  code-a-green: "#55ff55"
  code-e-yellow: "#ffff55"
  code-c-red: "#ff5555"
  code-6-gold: "#ffaa00"
  code-b-aqua: "#55ffff"
  code-d-pink: "#ff55ff"
  code-5-purple: "#c23bc2"
  code-7-gray: "#aaaaaa"
  code-8-dark-gray: "#7a7a7a"
  code-3-teal: "#00aaaa"
  running-green: "#1f9d3f"
typography:
  display:
    fontFamily: "Archivo, Inter, Segoe UI, sans-serif"
    fontSize: "54px"
    fontWeight: 900
    lineHeight: 0.95
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 72"
  headline:
    fontFamily: "Archivo, Inter, Segoe UI, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 78"
  title:
    fontFamily: "Archivo, Inter, Segoe UI, sans-serif"
    fontSize: "19px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "0.01em"
    fontVariation: "'wdth' 78"
  section:
    fontFamily: "Archivo, Inter, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 800
    letterSpacing: "0.05em"
    fontVariation: "'wdth' 82"
  stat:
    fontFamily: "Archivo, Inter, Segoe UI, sans-serif"
    fontSize: "19px"
    fontWeight: 800
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 80"
  body:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    fontFeature: "'cv11', 'ss01'"
  motd:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Silkscreen, Archivo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.02em"
rounded:
  tag: "2px"
  sm: "4px"
  md: "6px"
spacing:
  tight: "8px"
  grid: "12px"
  module: "14px"
  panel: "18px"
  page: "28px"
components:
  button-play:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    typography: "{typography.display}"
    rounded: "{rounded.sm}"
    padding: "0 34px"
    height: "54px"
  button-play-hover:
    backgroundColor: "color-mix(in oklab, #9d5cff 86%, #fff)"
  button-play-running:
    backgroundColor: "{colors.running-green}"
    textColor: "#ffffff"
  button:
    backgroundColor: "rgba(157, 92, 255, .16)"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-hover:
    backgroundColor: "rgba(157, 92, 255, .28)"
  button-ghost:
    backgroundColor: "rgba(255, 255, 255, .03)"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-small:
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "30px"
  rank-tag:
    backgroundColor: "rgba(0, 0, 0, .35)"
    textColor: "{colors.code-7-gray}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "0 5px"
    height: "18px"
  loader-tag:
    backgroundColor: "rgba(0, 0, 0, .35)"
    textColor: "{colors.code-7-gray}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "0 6px"
    height: "20px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "18px"
  input:
    backgroundColor: "{colors.well}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "38px"
  nav-item:
    textColor: "{colors.text-dim}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "34px"
  nav-item-active:
    backgroundColor: "color-mix(in oklab, #9d5cff 42%, transparent)"
    textColor: "#ffffff"
  modal:
    backgroundColor: "{colors.overlay}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
---

# Design System: Nore Launcher

## Overview

**Creative North Star: "The Server List"**

Nore Launcher is set in the same material a player already reads every session: the multiplayer server list, the chat line and the item tooltip. The ground is the tooltip's violet-black, panels are flat and opaque with a thin violet keyline the way a tooltip border is, and state is not drawn with icons or glows but written in § formatting colours. Rank tags in square brackets ([BETA], [EVENT], [NON-PREMIUM], [1.21.1]) carry status, and every instance and server introduces itself with a one-line MOTD.

The shell is dense and practical. A solid accent-tinted rail holds the logo, grouped navigation with rank-tag badges, the account chip and a mini-play strip; the main column stacks hairline-boxed modules tightly, each marked with a small coloured header tab on its top keyline. One element is allowed to shout: the solid Graj block. Everything else stays tinted, outlined, and quiet, so the § codes can be read at a glance.

The signature is §k: obfuscated pixel glyphs that resolve, left to right, into the instance name when the page opens and when the game launches. It is the one moment of theatre, and it switches off with reduced motion. The category default of glowing glass cards over a blurred wallpaper is explicitly rejected; the background scene stays, held back behind a 74 to 97% violet-black shade and opaque panels.

**Key Characteristics:**
- Tooltip violet-black ground, flat opaque panels, 1px violet keyline.
- § formatting colours used only where they mean a state.
- Rank tags in Silkscreen pixel caps, always bracketed.
- Archivo condensed heavy caps for headings; Inter for all working text.
- One solid colour block per view: Graj.
- Changed rows stay lit until the player has seen them.
- Accent is user-themable; every accent use resolves through the accent tokens.

## Colors

A near-black violet world where the only saturated colours are the user's accent and the Minecraft formatting codes, and each code has a fixed meaning.

### Primary
- **Nore Violet** (accent): the themable accent (default #9d5cff, overridden at runtime through `--accent`, `--accent-2`, `--accent-deep`, `--accent-rgb`). Fills the Graj block, the active nav field (42% mix), switches, sliders, focus outlines, selected-card keylines and the default module header tab. The logo is hue-rotated to match it.
- **Lilac** (accent-light): the accent's light partner. Name highlights in headings (the second word of a split title), the §k glyphs while scrambling, the Nore Client MOTD code (§x), icon tints in the login side list and wizard chips.
- **Deep Violet** (accent-deep): avatar fields and the Microsoft sign-in button, where a solid fill is needed that must not compete with Graj.
- **Rail Field** (rail): derived from the accent, 13% accent into #0a0610. The rail, title bar, wizard rail, login side panel and updater footer. It recolours with the accent; never hard-code it.

### Neutral
- **Tooltip Black** (ground): the page ground behind everything, splash and wizard backgrounds.
- **Panel** (surface): every card, module and quick-link strip. Opaque.
- **Panel Raised** (surface-raised): the rail collapse toggle and small raised controls inside the rail.
- **Overlay** (overlay): modals, pop menus, toasts and the login card, the layers that sit above panels.
- **Well** (well): the sunken fill of inputs, search, segmented controls, progress tracks, switch tracks, stat pills and the device-code cells.
- **Tooltip Keyline** (keyline): every 1px border, divider and row separator. Accent-tinted keylines (accent at 35 to 55% alpha) mark the hero band, modals and hovered panels.
- **Text / Dim / Muted** (text, text-dim, text-muted): primary copy; nav items and secondary copy; captions, placeholders, rank-tag brackets.

### State: the § formatting codes
The codes are a named state-colour set. They render as MOTD text, rank-tag colour, module header tabs, progress fills and status dots. Each keeps one meaning:
- **§a Green** (code-a-green): ready, online, running, done. Progress fills, server online state, signal bars, premium account tag, completed wizard steps, the updater's success.
- **§e Yellow** (code-e-yellow): pending, update, beta, attention. The [1.4 BETA] version chip, [BETA] Serwery badge, update module tab, the "lit until seen" mark, servers in a starting/transitional state, the updater's installing bar, Fabric loader MOTD.
- **§c Red** (code-c-red): error, stopped, danger. Stopped servers, alerts, the console badge, alpha version tags, the updater's error state.
- **§6 Gold** (code-6-gold): events. [EVENT] Halloween badge, the event chip, the servers module tab, version-type tags; also the Forge/NeoForge loader colour in MOTD lines.
- **§b Aqua** (code-b-aqua): info and links. All links, the default nav count badge, the "Ostatnio grane" module tab.
- **§d Pink / §5 Purple** (code-d-pink, code-5-purple): Nore itself. The Nore Client loader tag, the "Nowe w" news tab, Quilt loader MOTD.
- **§7 Gray / §8 Dark Gray** (code-7-gray, code-8-dark-gray): neutral MOTD body text and separators; offline account tag, the [WKRÓTCE] shop badge, plain version tags. §8 and §9 render lifted (#7a7a7a, #7a7aff) so they stay legible on the ground.
- **§3 Teal** (code-3-teal): the modpack loader tag.
- **Running Green** (running-green): the Graj block's running state only, a darker green so white text stays legible on a solid fill.

### Named Rules
**The Codes Carry State Rule.** A § colour appears only where it means its state. Never use §a for decoration or §c for emphasis; if a colour does not mean ready, pending, error, event, info or Nore, it is §7.

**The Themable Accent Rule.** Every accent use goes through `--accent`, `--accent-2`, `--accent-deep`, `--accent-rgb` or `--rail`. A literal violet hex in a component breaks the user's theme (the updater, which runs before settings load, is the one place the default is inlined).

## Typography

**Display Font:** Archivo variable (wdth 62 to 125%, wght 500 to 900), with Inter, Segoe UI
**Body Font:** Inter (wght 400 to 800, cv11 and ss01 on), with Segoe UI, system-ui
**Label Font:** Silkscreen (400), with Archivo, monospace

**Character:** Condensed heavy caps for anything that names a place, an instance or a number, set like a server name; neutral Inter for everything the player reads to work; a pixel face kept inside brackets so the game shows through without the interface becoming a pastiche. All three are bundled and self-hosted (CSP `font-src 'self'`).

### Hierarchy
- **Display** (Archivo 900, 54px, line-height 0.95, wdth 72%, uppercase): the instance name in the Start band only. Wizard headings use the same voice at 44px / wdth 74%, login at 40px / 30px, updater at 34px.
- **Headline** (Archivo 800, 34px, line-height 1, wdth 78%, uppercase): page heads and the server hero. Modal titles step down to 24px.
- **Title** (Archivo 800, 19px, wdth 78%, uppercase): instance card names. Server rows use 17px at wdth 90% in sentence case, as a server list does.
- **Section** (Archivo 800, 14px, wdth 82%, 0.05em, uppercase): module titles beside the coloured header tab.
- **Stat** (Archivo 800, 18 to 19px, wdth 80%, tabular figures): play time, player counts, RAM. Labels beneath at 11px uppercase 0.06em Inter.
- **Body** (Inter 400, 14px): all working copy; secondary lines 12.5 to 13.5px.
- **MOTD** (Inter 400, 14px, line-height 1.45, §7 by default): the one-line description under every instance and server; 12px in instance cards, 13.5px in server rows, single line with ellipsis.
- **Label** (Silkscreen 400, 11px, 0.02em, uppercase, unsmoothed): rank tags, loader tags, the version chip, wizard step numbers, the updater's version.

### Named Rules
**The Pixel In Brackets Rule.** Silkscreen appears only in rank tags, loader tags, step numbers and the §k glyphs. Never set a heading, button or paragraph in it.

**The Tabular Numbers Rule.** Every number that updates (stats, progress, player counts, device-code cells) uses tabular figures.

## Layout

A fixed desktop shell: a 36px title bar on the rail field, a 224px rail with a 1px keyline on its right, and a main view padded 18px top, 28px right, 30px bottom, 24px left. Page heads sit 18px above content.

Start stacks a wide instance band (min-height 290px, padding 28px 30px 22px) with the name, MOTD line and tags top-left, the Graj block bottom-left and a tabular stat strip bottom-right; then a single hairline-boxed quick-link strip (cells divided by keylines, not separate cards); then two columns of modules with a 14px gap. Grids use a 12px gap; panels pad 18px, modules 14px 16px. Density is deliberate: lists divide rows with 1px keylines rather than spacing them into floating cards.

Responsive: below 1100px the quick-link strip wraps to three columns with keylines redrawn; the login card drops its side panel below 860px. Further steps at 1120px, 1000px and 760px rearrange page grids.

## Elevation & Depth

Flat by default. Panels sit on the ground with a keyline and no shadow; depth between panel layers is tonal (well below surface below overlay). Shadow appears only on layers that genuinely float above the page, and as the bevel on solid blocks.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 14px 34px rgba(0, 0, 0, .5)`): modals, pop menus, toasts, the login card, the wizard preview screen.
- **Block bevel** (`box-shadow: inset 0 -4px 0 rgba(0, 0, 0, .28)`, pressed `inset 0 -2px 0`): the Graj block and the Microsoft sign-in button; the darker lower edge of a Minecraft button.
- **Selected keyline** (`box-shadow: inset 0 0 0 1px var(--accent)` with an accent border): selected cards, the active recent instance, chosen wizard scenes. A 2px keyline, never a glow.
- **Focus** (`outline: 2px solid var(--accent); outline-offset: 2px`; inputs `0 0 0 1px var(--accent)` with accent border).

### Named Rules
**The Tooltip Keyline Rule.** Panels are opaque fills with a 1px violet keyline. No glow, no glass, no backdrop blur, no gradient borders or gradient text.

## Shapes

Small, near-square corners that read as blocky without becoming pixel art: 6px for panels, modals and cards; 4px for buttons, inputs, nav items and icons; 2px for rank tags, loader tags and slider thumbs; 0 for progress bars, status dots, signal bars, the scrollbar thumb and the spinner (which steps in 8). Square dots replace round ones everywhere state is shown. Rank tags draw their own `[` and `]` in a muted mix of the tag colour.

**Known drift, not the system.** A legacy `:root` block left in styles.css (the "Nore 2.1 design refresh" section) still redeclares `--radius` 16px, `--radius-sm` 11px and a translucent `--surface` (rgba(18, 12, 26, .66)), and its `.card` rule still adds `0 12px 34px rgba(0, 0, 0, .28)`. Because the world layer reads those variables, shipped panels currently compute to 16px/11px translucent glass. That is a defect to repair, not a value to inherit; the tokens above are normative.

## Components

### Buttons
Tinted and outlined, so the one solid block stands alone.
- **Shape:** gently squared (4px).
- **Default:** accent tint at 16% with a 55% accent border, Inter 600 13px, 36px tall, 14px side padding; 30px small, 36px square icon variant. The tint colour is a per-button channel (`--c`), so danger and success reuse the same form.
- **Hover / Active:** tint rises to 28% and the border to 90%; press nudges 1px down. Transitions 0.15s. No lift, no glow.
- **Ghost:** 3% white with a keyline border and dim text; hover brightens text and swaps the border to the accent.
- **Disabled:** 40% opacity.

### The Graj Block (signature)
- One solid accent field, 54px tall, 34px side padding, Archivo 900 21px at wdth 80% with 0.1em tracking, white text, the block bevel on its lower edge.
- Hover mixes 14% white into the accent; press drops it 2px and halves the bevel.
- Running: the field turns running-green.
- At most one per view; the rail's mini-play is the compact repeat for other pages.

### Rank Tags
- Silkscreen 11px uppercase on an 18px strip (loader tags 20px), 2px corners, background = the tag's code at 12 to 13% over 35% black, text in the code colour, brackets drawn in a muted mix.
- Assignments: version chip §e, nav count §b, Serwery §e, Halloween §6, Sklep §7, Konsola §c, premium §a, offline §7, upd §e, alpha §c, loader tags by loader with a 5px square swatch, Nore Client §d, modpack §3.

### MOTD Lines
- Rendered from § strings by the MOTD renderer: colour codes 0 to f plus §x (accent-light), §l bold, §o italic, §n underline, §m strike, §r reset; unknown codes dropped, text escaped.
- Instance MOTD: loader name in its code (Fabric §e, Quilt §d, Forge/NeoForge §6, vanilla §a, Nore Client §x), §8 separator, §7 description.
- Server rows: the server's own MOTD, then a status line in §a running, §c stopped, §e otherwise.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** surface, opaque; modules draw a 34 by 3px header tab on the top keyline at 15px from the left, coloured by content (`--tab`: §b recent, §7 screenshots, §e updates, §d news, §a friends, §6 servers); the title icon takes the same colour.
- **Border:** 1px keyline; hover moves it to 55% accent and mixes 8% accent into the fill; selected uses the accent keyline; running servers and instances take a §a keyline.
- **Shadow Strategy:** none at rest (see Elevation).
- **Internal Padding:** 18px panels, 14px 16px modules, 12px 14px server rows and quick links.

### Inputs / Fields
- **Style:** well fill, 1px keyline, 4px corners, 38px tall, accent caret, muted placeholder.
- **Focus:** accent border plus a 1px accent ring.
- **Segmented / chips / switches:** well track; the chosen segment or chip takes a 40 to 45% accent mix; switches fill solid accent with a white knob; sliders are a 6px square track filled with accent and a 14 by 18px white thumb.

### Navigation
- Grouped rail nav: group labels 11px, 0.16em, #a89cbd; items 34px tall, 13.5px Inter, 17px stroke icons, dim text.
- Hover: 5% white field, full text. Active: a sliding 42% accent field (0.3s, ease) with white text and icon.
- Rank-tag badges sit flush right in each item.

### Server List Rows
- 64px server icon, name at 17px, a single MOTD line with ellipsis, and on the right a five-bar signal (3px bars, §a when online, #3a3346 off), the player or RAM count in stat type, and the status line. Actions sit below a keyline. The add row is a dashed keyline box.

### Lit Until Seen
- When a row's state changes (a server starts or stops, an instance gets content updates), it takes a 6px square §e mark in its top-right corner that blinks in two steps every 1.2s. Hover or focus clears it. Once-only marks are remembered across restarts.

### §k Reveal
- Instance names scramble through pixel glyphs (A to Z without I/O, digits, #$%&?@) in accent-light and resolve left to right over 560ms when the page opens and when the game launches. Screen readers get the final name via aria-label. Skipped under reduced motion or the in-app animation switch.

### Motion
- Ease: `cubic-bezier(.16, 1, .3, 1)` for everything; control state changes at 0.15s; list entries rise 10px over 0.45s with a 40ms stagger; modals pop 8px over 0.25s. Mechanical things step: spinners in 8 steps, the splash bar in 10, the lit mark and login loader in 2. Page transitions are a user choice (fade, slide, zoom, blur). `prefers-reduced-motion` and the in-app switch collapse all motion.

### Satellite surfaces
- **Login gate:** an overlay card (320px rail-field side + 440px main), device code set as server-address cells in condensed caps on the well; Microsoft button in accent-deep with the block bevel.
- **Nore Updater:** the same world in a frameless window: logo where a server icon sits, condensed caps title, status in accent-light then §a done or §c error, a square progress bar (§a downloading, §e installing), version as a §e rank tag in the rail-field footer.
- **Installer bitmaps:** generated from the same tokens (ground, rail, keyline, accent, Silkscreen [1.4 BETA] tag) by the installer art script.

### Event overlays
Halloween and winter are forced seasonal overlays layered on top of this system through `body.halloween` / `body.winter` and their own stylesheets. They add scene art and event components but are not part of the base system; the rail stays one accent field during events.

## Do's and Don'ts

### Do:
- **Do** give every instance and server a single MOTD line in § codes, §7 by default.
- **Do** express status as a bracketed rank tag in the matching code colour.
- **Do** keep panels opaque surface (#150f1e) with a 1px keyline and 6px corners.
- **Do** mark each module with a 34 by 3px header tab coloured by what it holds.
- **Do** keep Graj the only solid accent block in a view, with the 4px lower bevel.
- **Do** route every accent through the accent tokens and the derived rail so the user's theme recolours the whole shell and the logo.
- **Do** hold a changed row lit in §e until the player hovers or focuses it.
- **Do** use tabular figures for every live number.

### Don't:
- **Don't** use glass: no translucent cards, backdrop blur, glows or gradient borders over the wallpaper.
- **Don't** use gradient text or coloured text shadows.
- **Don't** use a § colour for decoration; a code that does not mean its state is §7.
- **Don't** set headings, buttons or body copy in Silkscreen; it lives inside brackets and §k only.
- **Don't** round past 6px or use pill shapes for tags and dots.
- **Don't** add uppercase tracked kickers above headings; the rank tag and the MOTD line do that job.
- **Don't** fold event styling (pumpkins, frost, event gradients) into base components; it belongs to the event overlays.
