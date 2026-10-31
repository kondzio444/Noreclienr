# Nore Launcher in Rust – porting checklist

`launcher-rs/` is the Rust rewrite of the Electron launcher (`launcher/`). It is built in phases;
**the Electron launcher stays the shipping product** until the Rust one reaches parity (the release
workflow `.github/workflows/build.yml` is untouched, `launcher-rs.yml` only builds and tests).

## Layout

| Path | What |
|---|---|
| `core/` (`nore-core`) | The backend: one module per Electron main-process module, async (tokio, reqwest + rustls, serde, thiserror). No UI dependency. |
| `core/src/ipc.rs` | `App::invoke(channel, args)` – every `ipcMain.handle` channel of `launcher/src/main/main.js`, with the same arguments and answers. `CHANNELS` is the status table below. |
| `core/src/bin/nore-cli.rs` | Headless driver: `channels`, `invoke <channel> [json…]`, `play --mc 1.21.1 --loader fabric`. |
| `src-tauri/` (`nore-launcher`) | Tauri 2 shell: window, dialogs, opener, Tauri updater; forwards `nore_ipc` calls to `nore-core` and core events to the webview. |
| `compat/nore-tauri.js` | Injected before the page loads (Tauri only): builds `window.nore` with exactly the shape of `launcher/src/preload.js` on top of `invoke` / `listen`. |
| `../launcher/src/renderer/` | The UI – **shared, not forked**: Tauri serves this folder as its frontend. In Electron `window.nore` already exists, so the compat script never runs there. |

## How to run

```sh
cd launcher-rs
cargo test --workspace                     # Rust unit tests (ports of the launcher JS tests)
cargo clippy --workspace --all-targets -- -D warnings
npm ci && npm test                         # window.nore compat layer vs launcher/src/preload.js
npx tauri dev                              # the launcher window (needs WebKitGTK on Linux)
npx tauri build --debug --bundles deb      # Linux package; Windows: npx tauri build --bundles nsis
cargo run -p nore-core --bin nore-cli -- channels
NORE_LAUNCHER_HOME=/tmp/nore cargo run -p nore-core --bin nore-cli -- play --mc 1.21.1 --loader fabric --seconds 30
```

Linux build dependencies: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libdbus-1-dev`.
`NORE_NO_KEYRING=1` skips the system key store (headless machines).

## How the Rust launcher relates to the Electron one

* **Same data folder** (`%APPDATA%/.norelauncher`, `~/.norelauncher`, `NORE_LAUNCHER_HOME`): versions,
  libraries, assets, Java runtimes and instance folders are shared, nothing is downloaded twice.
* **Own settings file** `launcher-rs.json` with the **same JSON schema** as `launcher.json` (kept as a
  JSON value, unknown fields survive). On the first start it is **imported** from the Electron launcher:
  settings, accounts, instances, friends and the chat identity (`store::import_electron`).
  * Microsoft sessions are re-sealed: Electron's AES-GCM fallback (`userData/session.key`) and
    `safeStorage` (Chromium os_crypt: Windows DPAPI + `Local State`, macOS Keychain
    "Nore Launcher Safe Storage", Linux `v10`) are read; Linux `v11` (desktop keyring) is not read in
    phase 1 – such a player logs in again (offline accounts never need anything).
  * The chat identity keeps its key pair, so the **Nore ID stays the same**; signatures are
    byte-compatible (ECDSA P-256, DER, SHA-256; tested against Node-made vectors).
* **Secrets**: a random 256-bit key in the OS key store (`keyring`: Credential Manager, Keychain,
  Secret Service), every token sealed with AES-256-GCM under it; without a key store the key is
  `launcher-rs.key` (mode 600). Tokens never touch the settings file in plain text, and nothing is
  committed: the Microsoft client id comes from `NORE_MS_CLIENT_ID` (env / build) or the Nore API,
  like today.
* **Updates**: `tauri-plugin-updater` reads `https://noreclient.pl/api/v2/updates/feed/latest.json`
  (the Worker 302-redirects to the release asset). It is active only in builds made with
  `NORE_UPDATER_PUBKEY` (the matching private key stays a CI secret); other builds report `dev`, like
  an unpackaged Electron launcher. Releases do not carry `latest.json` yet – that starts when Tauri ships.

## Status legend

* `[x]` ported – implemented in Rust with the Electron behaviour (unit-tested where it has logic)
* `[~]` stub – answers a neutral value (`[]`, `{}`, `true`) so the UI keeps working until phase 2
* `[ ]` pending – answers **"Funkcja w przygotowaniu w wersji Rust (kanał)."**; the renderer shows its
  normal error toast

The tests check that this list, `ipc::CHANNELS` and `launcher/src/preload.js` agree.

## Phase 1 modules (done)

| Electron | Rust | Notes |
|---|---|---|
| paths.js | `paths.rs` | + `launcher-rs.json`, Electron userData lookup |
| store.js | `store.rs` | defaults + one-time migrations, atomic save (mode 600), Electron import |
| net.js | `net.rs` | retry with exponential backoff (429/5xx/network), SHA-1 verified atomic downloads, parallel `download_all` |
| versions.js | `versions.rs` | manifest (+ offline cache), inheritance merge, rules, maven paths, natives, assets |
| java.js | `java.rs` | Mojang runtimes (all.json), `java -version` probe with cache, pick per MC version |
| jvm.js | `jvm.rs` | memory sizing, G1 / Generational ZGC flags, player args win – all jvm.test.js cases |
| loaders.js | `loaders.rs` | Fabric / Quilt profiles, Forge / NeoForge headless installers |
| instances.js, nore-mods.js | `instances.rs` | CRUD with the modpack rules, worlds, screenshots, sizes, backups, duplicate |
| launch.js | `launch.rs` | arguments, session ticket, quick play / --server, spawn, line-by-line log streaming, exit codes |
| auth.js + main.js accounts | `auth.rs`, `ipc.rs` | offline UUID, device code → Xbox → XSTS → Minecraft, refresh with the stored client id, single-flight refresh |
| official.js | `official.rs`, `nbt.rs` | servers.dat NBT (byte-identical with the JS writer), API v2 status + Server List Ping (+ SRV) |
| chat.js (identity, contacts, history) | `chat.rs` | same key / ID / signature formats |
| hub.js | `hub.rs` | canonical string identical to hub.js (`JSON.stringify` port in `js.rs`), heartbeat, Mojang join |
| notices.js | `notices.rs` | |
| updater.js | `updater.rs` + `src-tauri/src/updater.rs` | Tauri updater instead of electron-updater |
| gameopts.js | `gameopts.rs` | |
| social.js (friends) | `friends.rs` | gallery → phase 2 |
| modrinth.js (install only) | `modrinth.rs` | just what the game start needs: Fabric API + Nore Pack |

## Phase 2 plan

1. **Mods & content** – the mod manager (`mods:*`: list / identify / toggle / bulk / pins, profiles, modlist, export, changelogs, config editor), `modrinth.rs` (search, details, categories, identify by hash, updates,
   toggle / delete) and `curseforge.rs` (API key from env / Worker, blocked files); background update
   checks (`content:updatesState` / `content:checkAll`).
2. **Modpacks** – `.mrpack` / CurseForge zip install, update with world backup, instance importers
   (Prism / MultiMC / CurseForge app / Modrinth App), blocked-files resolution from Downloads.
3. **Performance mods** – perf.js (Sodium / Lithium / … plan, drop / keep rules, "Optymalizuj").
4. **Server hosting** – servers.js (incl. Velocity / BungeeCord, CurseForge / Hangar content, server packs with blocked files, properties form, MOTD / JVM previews, console completion, TPS events), server-content.js, server-net.js (UPnP, firewall, DNS),
   server-tunnel.js (playit.gg); `servers:*` and the `server:*` events.
5. **Chat P2P & bridge** – chat-bridge.js (local HTTP bridge for the in-game chat, `chat:presence`),
   cosmetics from the game (`hub::Hub` already takes them).
6. **Discord RPC** – discord.js over the local IPC pipe.
7. **Doctor** – log analysis, preflight checks and automatic crash repair.
8. **Gallery** – thumbnails (`image` crate), clipboard copy, reveal / open / delete.
9. **Polish** – updater splash window (updater.html), launcher priority while playing, single
   instance lock, bundling the Nore Client jars (`resources/mods` → `nore/mods`), signing, then the
   switch of the release workflow to Tauri.

## Channels
#### app

- [x] `app:info`

#### state

- [x] `state:get`

#### settings

- [x] `settings:set`

#### onboarding

- [x] `onboarding:done`

#### dialog

- [x] `dialog:java`

#### shell

- [x] `shell:open`
- [x] `shell:folder`

#### window

- [x] `window:minimize`
- [x] `window:maximize`
- [x] `window:close`

#### auth

- [x] `auth:status`
- [x] `auth:logout`

#### accounts

- [x] `accounts:offline`
- [x] `accounts:msStart`
- [x] `accounts:msPoll`
- [x] `accounts:msCancel`
- [x] `accounts:select`
- [x] `accounts:remove`

#### versions

- [x] `versions:list`
- [x] `versions:fabricLoaders`
- [x] `versions:installed`
- [x] `versions:delete`

#### storage

- [x] `storage:info`

#### instances

- [x] `instances:create`
- [x] `instances:update`
- [x] `instances:remove`
- [x] `instances:select`
- [x] `instances:folder`
- [x] `instances:worlds`
- [x] `instances:worldsInfo`
- [x] `instances:screenshots`
- [x] `instances:deleteWorld`
- [x] `instances:backupWorld`
- [x] `instances:deleteScreenshot`
- [x] `instances:size`
- [x] `instances:media`
- [x] `instances:setMedia`
- [x] `instances:stats`
- [x] `instances:duplicate`
- [x] `instances:optionsProfile`
- [x] `instances:memoryInfo`

#### official

- [x] `official:info`
- [x] `official:status`
- [x] `official:pick`

#### game

- [x] `game:launch`
- [x] `game:prepare`
- [x] `game:kill`

#### servers

- [~] `servers:list`
- [ ] `servers:create`
- [ ] `servers:update`
- [ ] `servers:remove`
- [ ] `servers:start`
- [ ] `servers:stop`
- [ ] `servers:command`
- [ ] `servers:logs`
- [ ] `servers:folder`
- [ ] `servers:restart`
- [ ] `servers:stats`
- [ ] `servers:properties`
- [ ] `servers:players`
- [ ] `servers:playerList`
- [ ] `servers:backup`
- [ ] `servers:backups`
- [ ] `servers:restoreBackup`
- [ ] `servers:deleteBackup`
- [ ] `servers:resetWorld`
- [ ] `servers:reinstall`
- [ ] `servers:setIcon`
- [ ] `servers:icon`
- [ ] `servers:contentKinds`
- [ ] `servers:contentSearch`
- [ ] `servers:contentInstall`
- [ ] `servers:contentList`
- [ ] `servers:contentToggle`
- [ ] `servers:contentRemove`
- [ ] `servers:contentAddFiles`
- [ ] `servers:contentUpdates`
- [ ] `servers:contentApplyUpdates`
- [ ] `servers:contentAddPaths`
- [ ] `servers:modpackVersions`
- [ ] `servers:modpackUpdate`
- [ ] `servers:modpackApply`
- [ ] `servers:loaderVersions`
- [ ] `servers:diagnose`
- [ ] `servers:firewall`
- [ ] `servers:dnsCheck`
- [ ] `servers:tunnelLink`
- [ ] `servers:tunnelUnlink`
- [ ] `servers:tunnel`
- [ ] `servers:netInfo`
- [ ] `servers:checkReachable`
- [ ] `servers:upnp`
- [ ] `servers:applyDomain`
- [ ] `servers:dnsRecords`
- [ ] `servers:contentSources`
- [ ] `servers:blocked`
- [ ] `servers:resolveBlocked`
- [ ] `servers:propertiesForm`
- [ ] `servers:saveProperties`
- [ ] `servers:complete`
- [ ] `servers:jvmPreview`
- [ ] `servers:motdPreview`

#### mods

- [ ] `mods:list`
- [ ] `mods:identify`
- [ ] `mods:toggle`
- [ ] `mods:bulk`
- [ ] `mods:pin`
- [ ] `mods:saveProfile`
- [ ] `mods:applyProfile`
- [ ] `mods:deleteProfile`
- [ ] `mods:modlist`
- [ ] `mods:saveModlist`
- [ ] `mods:exportPack`
- [ ] `mods:changelog`
- [ ] `mods:configs`
- [ ] `mods:readConfig`
- [ ] `mods:saveConfig`

#### content

- [ ] `content:search`
- [ ] `content:project`
- [ ] `content:details`
- [ ] `content:identify`
- [ ] `content:categories`
- [ ] `content:install`
- [ ] `content:installed`
- [ ] `content:toggle`
- [ ] `content:updates`
- [ ] `content:applyUpdates`
- [ ] `content:delete`
- [~] `content:updatesState`
- [ ] `content:checkAll`

#### chat

- [x] `chat:identity`
- [x] `chat:contacts`
- [x] `chat:add`
- [x] `chat:remove`
- [x] `chat:sign`
- [x] `chat:verify`
- [x] `chat:seen`
- [x] `chat:requests`
- [x] `chat:addRequest`
- [x] `chat:decline`
- [x] `chat:history`
- [x] `chat:put`
- [x] `chat:read`
- [x] `chat:clear`
- [x] `chat:attention`
- [~] `chat:presence`

#### curseforge

- [ ] `curseforge:status`
- [ ] `curseforge:setKey`

#### modpacks

- [ ] `modpacks:install`
- [ ] `modpacks:import`
- [ ] `modpacks:checkUpdate`
- [ ] `modpacks:update`
- [ ] `modpacks:versions`
- [ ] `modpacks:importInstance`
- [ ] `modpacks:blocked`
- [ ] `modpacks:resolveBlocked`

#### perf

- [ ] `perf:preview`
- [ ] `perf:apply`
- [ ] `perf:remove`
- [ ] `perf:decline`

#### loaders

- [x] `loaders:versions`

#### bg

- [x] `bg:custom`
- [x] `bg:pick`

#### doctor

- [ ] `doctor:check`
- [ ] `doctor:fix`

#### friends

- [x] `friends:list`
- [x] `friends:add`
- [x] `friends:remove`

#### gallery

- [ ] `gallery:list`
- [ ] `gallery:full`
- [ ] `gallery:copy`
- [ ] `gallery:reveal`
- [ ] `gallery:open`
- [ ] `gallery:delete`

#### notices

- [x] `notices:get`

#### update

- [x] `update:state`
- [x] `update:check`
- [x] `update:download`
- [x] `update:install`

#### net

- [x] `net:check`

