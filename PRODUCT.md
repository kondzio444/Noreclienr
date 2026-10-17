# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Nore Launcher is an Electron desktop app for Windows, Linux and macOS; its interface is HTML/CSS/JS in `launcher/src/renderer`. Nore Client is a Minecraft mod whose UI is drawn in-game through the `Gfx` API in `common/`.)

## Users

A mix of Minecraft players (confirmed by the owner):

- PvP players who join servers quickly and care about a fast start, FPS and the built-in Nore Client;
- players who install modpacks, mods, resource packs and shaders and manage several instances.

Both groups play premium (Microsoft) and non-premium (nickname only) accounts.

## Product Purpose

Nore Launcher installs and starts Minecraft (any version, vanilla or modded) and ships Nore Client, a PvP/QoL client mod, ready to play. Success: from opening the launcher to playing takes one click, and everything a player does around the game (content, servers, friends, events) happens in the same place.

## Positioning

Four things together, confirmed by the owner as the heart of the product:

1. **Nore Client built in** – the radial menu, HUD, wardrobe (capes, wings, hats) and scene editor work right after install, on many Minecraft versions.
2. **Servers in one click** – a local Paper/Purpur/Fabric/Quilt/Forge/NeoForge server with port forwarding, domains and a playit.gg tunnel for friends.
3. **Friends, chat and voice** inside the launcher, also reachable from the game.
4. **Events and cosmetics** – Halloween and Christmas are always on; seasonal capes and cosmetics.

## Operating Context

- First run: Windows NSIS installer → Nore Updater splash (checks/installs updates, greets new versions) → onboarding wizard (account, look, RAM, install) → home.
- Daily: pick an instance, press Play; browse Modrinth/CurseForge content; manage servers; talk to friends; check events.
- Updates come from GitHub Releases through the noroclient.pl API; the launcher updates itself and the mod.
- Website and public API: noroclient.pl (+ /api docs).

## Capabilities and Constraints

- Pages: Start, Instancje, Serwery, Halloween (event), Modpacki, Mody, Paczki zasobów, Shadery, Datapacki, Znajomi, Czat i głos, Galeria, Sklep (coming soon), Konta, Ustawienia, Konsola; onboarding wizard; Nore Updater splash.
- Accounts: Microsoft device-code login and offline nicknames; tokens only in OS secure storage.
- Accent colour is user-selectable (Nore violet by default); the logo is recoloured to the accent.
- Security: renderer IPC restricted to the launcher's own page; keys are baked in at build time, never committed.
- Interface language today: Polish (not declared binding).

## Brand Commitments

Binding (confirmed by the owner):

- **Violet accent and the Nore "NC" logo** stay; the logo keeps being recoloured to the accent.
- **Non-premium play** is always available; login is never forced.
- **Events are forced on**: Halloween now, Christmas/winter automatically from 10 December 2026; they cannot be switched off.

## Evidence on Hand

- Real product screenshots: `docs/screenshots/`, `web/public/assets/` (launcher login, capes GIFs), `web/public/assets/api/` (Nore Updater, main menu, winter card, radial menu, launcher wizard), `web/public/assets/api/updater.webm` (Updater clip).
- Logo: `launcher/src/renderer/assets/logo.png`, `branding/`.
- No testimonials, user counts, reviews or press exist; never fabricate them.

## Product Principles

1. One click to play: the path from launch to in-game is the product's spine; everything else must not slow it down.
2. Both player types are first-class: a PvP player and a modpack player each find their thing without digging.
3. The social and server features are part of playing, not a separate app.
4. Events give the launcher a living, seasonal feel, always on.
5. Trust: real data only, secure accounts, verified downloads.
