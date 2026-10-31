# Nore admin API – contract

The administration of Nore (blacklist, announcements, warns, bot control, client switches, releases,
source code, audit) lives in the Worker under `https://noreclient.pl/api/v2/admin/*`
(`web/src/v2/admin.js`, data in the `NoreAdmin` Durable Object, `web/src/v2/admin-store.js`).
The user interface is the private desktop app **AdmNoreclient** (separate, private repository);
nothing in this public repository contains a secret.

## Authentication

Either of:

* `Authorization: Admin <ADMIN_TOKEN>` – Worker secret, at least 32 characters (the desktop app).
* The panel session cookie `__Host-nore_s` (Discord login, `docs/bot-api.md`) of a Discord user whose
  ID is listed in the Worker secret `ADMIN_DISCORD_IDS` (comma separated). Writes with a foreign
  `Origin` are refused (403 `bad_origin`).

Comparisons are constant time (`safeEqual`). Without both secrets every admin route answers
`503 admin_disabled`; a wrong token `401` (`WWW-Authenticate: Admin realm="nore-admin"`), a logged-in
non-admin `403 not_admin`. Answers are `Cache-Control: private, no-store`, no CORS for foreign origins.

```sh
cd web
openssl rand -base64 48 | tr -d '\n' | npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put ADMIN_DISCORD_IDS     # e.g. 123456789012345678,234567890123456789
npx wrangler secret put GITHUB_TOKEN          # optional: source view, private releases, higher rate limit
```

Every write is recorded in the audit log: `{ id, at, actor: { via: token|discord, id, name }, action, target, data, ip }`
(the newest 5000 entries are kept).

## Envelope

Same as API v2 (`docs/bot-api.md`): success `{ ok: true, ...fields }`, error
`{ ok: false, status, code, error }` with a Polish `error`. Times are ISO 8601.

## Admin routes (`/api/v2/admin/…`)

| method | path | |
|---|---|---|
| GET | `me` | `{ actor, features: { token, discordAdmins, github, privateReleases, mcServer } }` |
| GET | `overview` | dashboard: `hub` (online, known, activeDay, hellosHour, versions, players), `bot` (guilds, pendingActions), `events`, `downloads`, `server` (mc.noreclient.pl ping), `counts`, `audit`, `flags` |
| GET | `blacklist?all=1` | entries `{ id, kind, value, display, reason, by, created, expires, active }` |
| POST | `blacklist` | `{ kind: mc_name\|mc_uuid\|nore_id\|discord\|auto, value, reason?, expiresAt? }` → 201 (200 when it updated an existing entry); syncs Nore Hub |
| DELETE | `blacklist/:id` | remove; syncs Nore Hub |
| POST | `blacklist/sync` | push the list to Nore Hub again |
| GET | `announcements` | all, with `state: active\|scheduled\|ended` |
| POST | `announcements` | `{ title (1–120), body (≤2000), level: info\|warning\|event, targets: [launcher, mod, web, discord], link? (https), startsAt?, endsAt? }` → 201 |
| PUT | `announcements/:id` | partial update (missing fields keep their value) |
| DELETE | `announcements/:id` | |
| GET | `warns` | overview `{ subjects: [{ subjectKind, subject, display, warns, notes, last }], recent }` |
| GET | `warns?subject=Steve&kind=auto` | history of one player `{ subject, blacklisted, warns }` |
| POST | `warns` | `{ subject, subjectKind?, kind: warn\|note, text (1–1000) }` → `{ warn, activeWarns }` |
| DELETE | `warns/:id` | revoke (stays in the history with `revoked`, `revokedBy`) |
| GET | `bot/guilds` | every guild the bot reported (present or left), config version, last event |
| GET | `bot/guilds/:id` | `{ meta, config, version, updatedAt, updatedBy, events }` |
| PUT | `bot/guilds/:id/config` | `{ config, version }` – same schema validation and 409 version check as the panel |
| GET | `bot/events?limit=&type=` | newest events of every guild |
| GET | `bot/actions?status=` | the action queue |
| POST | `bot/actions` | `{ type, guildId?, … }`: `message` (`guildId`, `channelId`, `content`), `leave` (`guildId`), `reload` (`guildId?`), `meta` (`guildId?`), `announce` (`announcementId`, `guildId?`) |
| DELETE | `bot/actions/:id` | cancel a pending action |
| GET | `client?q=&limit=` | Nore Hub players (name, Nore ID, launcher version, online, blocked), versions in use, flags, platforms |
| GET / PUT | `flags` | `{ maintenance: { enabled, message }, minLauncherVersion, killSwitch: { modules: [] }, features: { name: bool } }` (PUT is partial) |
| GET | `releases` | releases, downloads per platform, stats, last sync |
| POST | `releases/sync` | refresh the GitHub release data now |
| GET | `server?address=` | Minecraft server ping (default `ADMIN_MC_SERVER` or mc.noreclient.pl) |
| GET | `source?branch=&fresh=1` | GitHub: repo, commits, branches, releases, Actions runs, open pull requests (cached 60 s; `GITHUB_TOKEN` optional) |
| GET | `audit?limit=&before=&action=` | audit log, newest first (`next` = `before` of the next page) |

## Public readers

| path | |
|---|---|
| `GET /api/v2/announcements?target=launcher\|mod\|web\|discord` | active announcements `{ id, title, body, level, targets, link, startsAt, endsAt, updatedAt }` |
| `GET /api/v2/client/config?target=launcher\|mod` | `{ maintenance, minLauncherVersion, latestLauncherVersion, killSwitch, features, announcements }` |
| `GET /api/v2/blacklist/check?name=&uuid=&noreId=&discord=` | `{ blocked, matches: [{ kind, reason, expires }] }` |

Consumers:

* **Nore Hub** (`web/src/hub.js`) gets the Minecraft / Nore ID part of the blacklist pushed on every
  change: a blacklisted player's hello is refused (`403`) and they are never listed by
  `/api/v1/hub/players` or `/api/v2/players/:name`; a game presence heartbeat
  (`POST /api/v2/presence`) with a blacklisted nick answers `403` and is not counted. The hello may carry an optional, unsigned
  `client` (launcher version) shown in the admin overview.
* **Launcher** (`launcher/src/main/notices.js`): reads `client/config?target=launcher` every 15 min,
  shows announcements and maintenance in a banner, and when `minLauncherVersion` is newer than
  itself starts the update check.
* **Mod** (`common/…/util/NoreRemote.java`): reads `client/config?target=mod` – announcements on top
  of the main menu news, modules in `killSwitch.modules` (module names) are switched off and cannot
  be switched on.
* **Website** (`web/public/assets/album.js`): `target=web` announcements as a strip on every page.
* **Nore Bot** (`discord-bot/src/core/admin-link.js`): polls `GET /api/v2/bot/admin` every 30 s
  (`Authorization: Bot …`): `{ blacklist: { discord: [ids] }, actions: [pending], announcements: [target discord] }`.
  Blacklisted Discord users cannot use the bot's commands, a blacklisted guild ID makes the bot leave
  the guild; actions are executed and reported with `POST /api/v2/bot/actions/:id { ok, result }`;
  announcements are posted to the channel set in the panel (Nore → Ogłoszenia Nore).

## Private repository

The launcher's updates and every download link keep working when `kondzio444/Noreclienr` becomes
private: set `GITHUB_TOKEN` (fine-grained, *Contents: read* on the repository) and the variable
`RELEASES_PRIVATE=true` (`wrangler.jsonc` `vars` or `npx wrangler secret put RELEASES_PRIVATE`).

* File links in API v1/v2 then point at `https://noreclient.pl/api/v2/files/v<version>/<name>`,
  which redirects to the short-lived signed URL GitHub gives for the asset API.
* `/api/v1/download/:platform` and `/api/v2/downloads/:platform` redirect the same way.
* `GET /api/v2/updates/feed/<name>` is an electron-updater *generic* feed of the newest stable
  release: `latest.yml`, `latest-linux.yml`, `latest-mac.yml` as text, installers and blockmaps as
  302. Nore Launcher 1.5+ uses this feed (`launcher/src/main/updater.js`) and keeps its own
  fallback (Nore API → installer download with SHA-256 check).

Launchers older than this change only know github.com links: their fallback refuses
`noreclient.pl/api/v2/files/…` links, so publish one release with this launcher **before** making
the repository private.
