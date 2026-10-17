---
version: 1
slug: "launcher-src-renderer-index-html"
primary_target: "launcher/src/renderer/index.html"
related_targets: ["launcher/src/renderer/updater.html","launcher/build/installer.nsh"]
---

# Nore Launcher – app shell (Operate)

Scope: the whole Electron renderer (index.html, styles.css + motd.css, js/*.js), the Nore Updater splash (updater.html/.css) and the NSIS installer bitmaps (launcher/build/*.bmp). Mode: Operate.

Audience: PvP players who want to be in game in one click and modpack players who manage several instances; premium and non-premium alike. Job: pick an instance, press Graj; around that, content, servers, friends, events.

Constraints: keep every feature and every JS-generated class; violet accent stays (user-selectable), logo recoloured to it; non-premium always; events forced (Halloween now, winter from 10.12.2026); Polish copy; offline-safe (fonts bundled, CSP font-src 'self').

## Direction contract

THESIS: The launcher reads like the server list and chat a player already lives in: § formatting colours carry state, rank tags carry status, and the MOTD line is how every instance and server introduces itself. It refuses the category default of glowing glass cards on a blurred wallpaper.

OWN-WORLD: Ground is the item-tooltip near-black violet (#0f0a16), panels flat and opaque with a 1px violet keyline (the tooltip border), radii 4–6px, no glows, no glass, no gradient text. Shell rail is a solid accent-tinted field. State colours are the formatting codes only where they mean something: §a ready/online, §e pending/update, §c error, §6 events, §b info, §d/§5 Nore. Type: Inter for work, Archivo condensed heavy for headings, Silkscreen pixel caps only inside rank tags like [BETA] and the §k effect.

STORY: The player sees their instance and Graj immediately, reads every row's state by its colour code, and trusts the launcher because it speaks the server list's language.

FIRST VIEWPORT: Left rail (accent field, logo, grouped nav with rank-tag badges, account + mini-play at the foot). Main: page head; on Start a wide instance band, name in condensed caps at ~48px with its MOTD line beneath in colour codes, version/loader rank tags, a solid Graj block button bottom-left, stats as a tabular strip right; below it dense hairline-boxed modules with small coloured header tabs.

FORM: Minecraft server-list MOTD, rank tags and § formatting codes (own grounded list, position 6 of 7; raises: hairline boxed modules with coloured header tabs and denser packing, from the Japanese high-density site; a changed row holds its colour lit until noticed, from the gate board). Signature move: §k obfuscated glyphs that resolve into the instance name when the page opens and when the game launches. seed:3c9cbc40027e9a83

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
