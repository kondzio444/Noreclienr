# Nore Launcher in Rust – porting checklist

`launcher-rs/` is the Rust rewrite of the Electron launcher (`launcher/`). Phase 1 ported the core
(game, Java, loaders, accounts, chat identity); **phase 2 ports every remaining IPC channel** – all
channels below are `[x]`. **The Electron launcher stays the shipping product**: `build.yml` still
publishes it; the Tauri installer and `latest.json` are only attached to the same release (job
`tauri`, when the updater signing key is configured). The switch-over is planned below.

## Layout

| Path | What |
|---|---|
| `core/` (`nore-core`) | The backend: one module per Electron main-process module, async (tokio, reqwest + rustls, serde, thiserror). No UI dependency. |
| `core/src/ipc.rs` | `App::invoke(channel, args)` – every `ipcMain.handle` channel of `launcher/src/main/main.js`, with the same arguments and answers. `CHANNELS` is the status table below. |
| `core/src/ipc_more.rs` | The phase 2 channels (content, mod manager, modpacks, performance mods, doctor, gallery, servers). |
| `core/src/bin/nore-cli.rs` | Headless driver: `channels`, `invoke <channel> [json…]`, `play --mc 1.21.1 --loader fabric`, `modpack <project> [--version id]`, `launch <instance>`, `server --type paper --mc 1.21.1` (`--shot file.png` takes a screenshot of the game window). |
| `src-tauri/` (`nore-launcher`) | Tauri 2 shell: window, updater splash (`splash.rs`, shared `updater.html`), dialogs (open / save / folder / multi-file), opener + reveal, clipboard, Tauri updater; forwards `nore_ipc` calls to `nore-core` and core events to the webview; stops running servers (and waits for their saves) before exiting. |
| `src-tauri/windows/` | NSIS template (tauri-bundler 2.7.5 + orange finish-page checkboxes) and `hooks.nsh` (album colours, Polish texts). |
| `scripts/` | `prepare-mods.js` (Nore Client jars → `<resources>/nore/mods`, like `launcher/scripts/copy-mod.js`), `latest-json.js` (Tauri updater feed). |
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
  an unpackaged Electron launcher. Releases carry `latest.json` (job `tauri` in build.yml) once the signing key is configured.

## Status legend

* `[x]` ported – implemented in Rust with the Electron behaviour (unit-tested where it has logic)
* `[~]` stub – answers a neutral value (`[]`, `{}`, `true`) so the UI keeps working (none left)
* `[ ]` pending – answers **"Funkcja w przygotowaniu w wersji Rust (kanał)."**; the renderer shows its
  normal error toast (none left; a channel added to preload.js later starts here)

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
| social.js (friends) | `friends.rs` | gallery in phase 2 |

## Phase 2 modules (done)

| Electron | Rust | Notes |
|---|---|---|
| modrinth.js | `modrinth.rs` | search (facets), categories, details, install with dependencies (a dependency the folder has – also from CurseForge – is skipped), installed list, updates by SHA-1 with `.nore-backup` (3 newest kept), identify |
| curseforge.js | `curseforge.rs` | API with the player's key (sealed in the settings) or a CI key (`NORE_CF_KEY`), else the Nore proxy `noreclient.pl/api/v1/cf`; fingerprints (MurmurHash2 = JS values), manifest tasks with blocked files, `to_index` |
| modpacks.js | `modpacks.rs` | .mrpack + CurseForge zips, safe updates (`swap_files`, rollback, world backup on MC change), blocked files from Downloads (also "name (1).jar") |
| importers.js | `importers.rs` | Prism / MultiMC, CurseForge app, Modrinth App |
| perf.js | `perf.rs` | catalog, plan, blame, scan, resolve, ensure / remove / take back |
| mod-meta.js, mod-manager.js, config-edit.js, ipc-mods.js | `mod_meta.rs`, `mod_manager.rs`, `config_edit.rs`, `ipc_more.rs` | metadata + analysis, toggles, bulk, pins, profiles, mod lists, .mrpack / CurseForge export, config editor (TOML / properties / JSON / cfg keep formatting) |
| doctor.js | `doctor.rs` | preflight, deep check, crash log analysis, fixes; runs before every launch and after a crash (`doctor:report`) |
| servers.js | `servers.rs` | all 10 server types, install, start / stop / restart, console, auto-restart (3 in 10 min), schedule (restart + warnings, backups), TPS poll, players lists, backups, properties, proxies |
| server-content.js, server-cf.js, hangar.js | `server_content.rs`, `server_cf.rs`, `hangar.rs` | plugins / mods / datapacks / modpacks, server packs, updates from all three sources |
| server-props.js, server-tools.js | `server_props.rs`, `server_tools.rs` | form, validation, warnings, MOTD colours; schedule, TPS, join / leave, autocomplete |
| server-net.js | `server_net.rs` | LAN addresses (`if-addrs`), UPnP IGD (SSDP + SOAP), NAT-PMP, firewall (Windows), DNS check (1.1.1.1 / 8.8.8.8), DuckDNS / No-IP / Dynu / Cloudflare, diagnosis |
| server-tunnel.js | `server_tunnel.rs` | playit.gg agent CLI |
| nore-domains.js | `nore_domains.rs` | `<name>.noreclient.pl`, requests signed with the Nore ID (same canonical string) |
| chat-bridge.js | `chat_bridge.rs` | same routes, token + Host checks, 25 s long poll; random port on 127.0.0.1 |
| discord.js | `discord.rs` | Discord IPC (named pipe / unix socket), reconnect every 15 s |
| social.js (gallery) | `gallery.rs` | thumbnails with the `image` crate (360 px PNG), full image, RGBA → clipboard |
| main.js `runSplash` | `src-tauri/src/splash.rs` | same timings, one automatic install attempt per version |
| preload `pathForFile` | `compat/nore-tauri.js` | Tauri `tauri://drag-*` events replayed as DOM drag events with File objects whose paths `pathForFile` knows |

Differences that remain:

* **Chat P2P transport** stays in the webview (WebRTC / PeerJS in `launcher/src/renderer`), exactly as in
  Electron – the backend only keeps identity, contacts and history (`chat.rs`) and the in-game bridge.
  A Rust transport would need a WebRTC stack for the same peers; not worth it while the renderer works.
* **Hub cosmetics from the game** (`/v1/presence`) are stored and used for the next Nore Hub hello; Electron
  re-sends a running heartbeat at once.
* **Launcher priority while playing** (`os.setPriority`) is not ported – the game gets normal priority anyway.
* Secrets of the Electron launcher (`enc:` safeStorage values: domain tokens, CurseForge key, playit secret)
  are read through `oscrypt.rs` when present; new values are sealed as `rs:` with the Rust key.

## Switch-over plan (Electron → Tauri)

1. **Now**: every release carries the Electron installer + `latest.yml` (Electron auto-update) and – when
   `TAURI_SIGNING_PRIVATE_KEY` / `NORE_UPDATER_PUBKEY` are set – `NoreLauncher-rs-Setup-<v>.exe`, its `.sig`
   and `latest.json`. Testers install the Tauri build by hand; it updates itself from `latest.json`.
2. **Bridge release (Electron)**: one Electron version whose updater, after its normal update check, downloads
   `NoreLauncher-rs-Setup-<v>.exe` from the same release (checked against the `.sig` / SHA-256 published next
   to it), runs it with `/S` (current-user NSIS, same `%APPDATA%/.norelauncher` data folder) and quits. Nothing
   is migrated by hand: on its first start the Rust launcher imports `launcher.json` (settings, accounts with
   re-sealed Microsoft sessions, instances, friends, servers, chat identity – see "How the Rust launcher
   relates…"), game files are shared. The Electron app stays installed (Programs list) as a fallback.
3. **Cleanup release (Tauri)**: the Rust launcher detects the old Electron install
   (`%LOCALAPPDATA%/Programs/nore-launcher`) and offers to remove it (runs its uninstaller with `/S`; the
   uninstaller keeps game data). `build.yml` stops building Electron; the `latest.yml` of the last Electron
   build keeps pointing at the bridge release.
4. Rollback at any point: Electron reads its own `launcher.json`, which the Rust launcher never writes.

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

- [x] `servers:list`
- [x] `servers:create`
- [x] `servers:update`
- [x] `servers:remove`
- [x] `servers:start`
- [x] `servers:stop`
- [x] `servers:command`
- [x] `servers:logs`
- [x] `servers:folder`
- [x] `servers:restart`
- [x] `servers:stats`
- [x] `servers:properties`
- [x] `servers:players`
- [x] `servers:playerList`
- [x] `servers:backup`
- [x] `servers:backups`
- [x] `servers:restoreBackup`
- [x] `servers:deleteBackup`
- [x] `servers:resetWorld`
- [x] `servers:reinstall`
- [x] `servers:setIcon`
- [x] `servers:icon`
- [x] `servers:contentKinds`
- [x] `servers:contentSearch`
- [x] `servers:contentInstall`
- [x] `servers:contentList`
- [x] `servers:contentToggle`
- [x] `servers:contentRemove`
- [x] `servers:contentAddFiles`
- [x] `servers:contentUpdates`
- [x] `servers:contentApplyUpdates`
- [x] `servers:contentAddPaths`
- [x] `servers:modpackVersions`
- [x] `servers:modpackUpdate`
- [x] `servers:modpackApply`
- [x] `servers:loaderVersions`
- [x] `servers:diagnose`
- [x] `servers:firewall`
- [x] `servers:dnsCheck`
- [x] `servers:tunnelLink`
- [x] `servers:tunnelUnlink`
- [x] `servers:tunnel`
- [x] `servers:netInfo`
- [x] `servers:checkReachable`
- [x] `servers:upnp`
- [x] `servers:applyDomain`
- [x] `servers:noreDomain`
- [x] `servers:dnsRecords`
- [x] `servers:contentSources`
- [x] `servers:blocked`
- [x] `servers:resolveBlocked`
- [x] `servers:propertiesForm`
- [x] `servers:saveProperties`
- [x] `servers:complete`
- [x] `servers:jvmPreview`
- [x] `servers:motdPreview`

#### mods

- [x] `mods:list`
- [x] `mods:identify`
- [x] `mods:toggle`
- [x] `mods:bulk`
- [x] `mods:pin`
- [x] `mods:saveProfile`
- [x] `mods:applyProfile`
- [x] `mods:deleteProfile`
- [x] `mods:modlist`
- [x] `mods:saveModlist`
- [x] `mods:exportPack`
- [x] `mods:changelog`
- [x] `mods:configs`
- [x] `mods:readConfig`
- [x] `mods:saveConfig`

#### content

- [x] `content:search`
- [x] `content:project`
- [x] `content:details`
- [x] `content:identify`
- [x] `content:categories`
- [x] `content:install`
- [x] `content:installed`
- [x] `content:toggle`
- [x] `content:updates`
- [x] `content:applyUpdates`
- [x] `content:delete`
- [x] `content:updatesState`
- [x] `content:checkAll`

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
- [x] `chat:presence`

#### curseforge

- [x] `curseforge:status`
- [x] `curseforge:setKey`

#### modpacks

- [x] `modpacks:install`
- [x] `modpacks:import`
- [x] `modpacks:checkUpdate`
- [x] `modpacks:update`
- [x] `modpacks:versions`
- [x] `modpacks:importInstance`
- [x] `modpacks:blocked`
- [x] `modpacks:resolveBlocked`

#### perf

- [x] `perf:preview`
- [x] `perf:apply`
- [x] `perf:remove`
- [x] `perf:decline`

#### loaders

- [x] `loaders:versions`

#### bg

- [x] `bg:custom`
- [x] `bg:pick`

#### doctor

- [x] `doctor:check`
- [x] `doctor:fix`

#### friends

- [x] `friends:list`
- [x] `friends:add`
- [x] `friends:remove`

#### gallery

- [x] `gallery:list`
- [x] `gallery:full`
- [x] `gallery:copy`
- [x] `gallery:reveal`
- [x] `gallery:open`
- [x] `gallery:delete`

#### notices

- [x] `notices:get`

#### update

- [x] `update:state`
- [x] `update:check`
- [x] `update:download`
- [x] `update:install`

#### net

- [x] `net:check`

