---
version: 1
slug: "launcher-src-renderer-index-html"
primary_target: "launcher/src/renderer/index.html"
related_targets: ["launcher/src/renderer/updater.html","launcher/build/installer.nsh","web/public/index.html","common/src/main/java/dev/noreclient/util/Theme.java"]
---

# Nore – whole identity, launcher shell first (Operate; website Persuade/Read)

Scope: the replacement visual world for every Nore surface: Electron renderer (index.html, styles, js), Nore Updater splash, NSIS installer art, the website (noreclient.pl, /api, /panel), the in-game client UI (Theme/Render2D/gui) and the seasonal events. Mode: Operate for launcher and game, Persuade for the website home, Read for the API docs.

Audience: PvP players who want to be in game in one click and modpack players who manage several instances; premium and non-premium alike; mostly Polish teenagers playing in the evening.

Constraints: keep every feature; violet accent stays (user-selectable), logo recoloured to it; non-premium always; events forced (Halloween now, winter from 10.12.2026); Polish copy; launcher offline-safe (fonts self-hosted, CSP font-src 'self'); in-game text uses Minecraft's own font.

## Direction contract

THESIS: Everything a player owns in Nore is a sticker in their album: instances, modules, cosmetics, friends, events. Turning something on sticks it into its slot; turning it off peels it and leaves the printed ghost. It refuses the category default of glowing glass cards on a blurred wallpaper, and the old server-list look.

OWN-WORLD: Black album card (#141216, fibre grain) as the ground; the rail is the album cover, accent-dyed bookcloth. Die-cut stickers with a white vinyl rim, flat at rest, lifting with a peel corner on hover; recessed ghost slots for anything off or empty; round dot stickers carry state (green ready, yellow waiting, red error, orange event, blue info, violet Nore); washi tape holds news clippings. Dela Gothic One for display, Onest for work, Minecraft's font in game.

STORY: The player opens the album, sees their instance as the biggest sticker and the violet Graj sticker beside it, reads state from the dots, and fills the album over time.

FIRST VIEWPORT: Rail of index tabs on the cover (active tab merges into the page). Page: the current instance as a 300px die-cut sticker tilted -3°, its name in Dela at 44px, label stickers for loader and version, the pill Graj sticker 64px tall directly under the name; right column of taped clippings and friends' head stickers; a row of recent instances in slots ending in a ghost slot "Nowa instancja".

FORM: a collector's sticker album with black card pages (position 5 of 7 grounded list). Raises: exact-length bars only (labanotation), dated acquisitions (sampler), a four-state vocabulary per live object (tensegrity), stickers alone own the lifted plane (multiplane), ghost slots designed as carefully as stickers (seven-segment), one strict slot grid (ASCII). Signature: stick and peel. seed:563e4485ad397fad

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
