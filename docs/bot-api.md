# Nore Bot ↔ Nore API v2 – contract

Two parts that are built separately and must agree on this file:

* **Nore Bot** – `discord-bot/`, a standalone Node.js (22+) process: `npm install` then `node .`
  (or `npm start`). discord.js gateway bot, many languages. Secrets only in `discord-bot/.env`
  (git-ignored): `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `NORE_API=https://noreclient.pl`,
  `NORE_BOT_SECRET`.
* **Panel** – on the website (`/panel`), Discord OAuth2 login (`identify guilds`), lets a member with
  *Manage Server* on a guild where the bot is present edit that guild's configuration. Served by the
  Worker (API v2). Worker secrets: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `NORE_BOT_SECRET`,
  `SESSION_KEY`.

## Configuration schema – owned by the bot

`discord-bot/config.schema.json` (JSON Schema draft 2020-12, generated/kept in sync by the bot) is the
single description of every setting: modules, fields, types, defaults, enums, and for each field
`x-ui` hints (`channel`, `role`, `text`, `textarea`, `toggle`, `select`, `color`, `number`, `list`) and
`x-i18n` label keys. The panel renders its forms **from this schema only** (no hard-coded fields), so
new bot features appear in the panel without web changes. The Worker bundles a copy of the file
(`web/src/bot-schema.json`, copied at build) and validates every write against it.

Translations of the labels: `discord-bot/locales/<lang>.json` under `panel.*`; the panel uses the
same files (copied to `web/public/panel/locales/`). Languages: pl (default) and en.

## Endpoints

All JSON, UTF-8, under `https://noreclient.pl/api/v2`.

Bot → API (header `Authorization: Bot <NORE_BOT_SECRET>`):

| method | path | body / result |
|---|---|---|
| GET | `/bot/guilds/:guildId/config` | `{ guildId, version, updatedAt, config }` (defaults when never saved) |
| PATCH | `/bot/guilds/:guildId/config` | `{ config (partial), baseVersion?, by?: { id }, reason? }` → `{ guildId, version, updatedAt, updatedBy, config }` – the bot saves what it changed itself (builder, `/config`, panel actions) so the panel shows it |
| PUT | `/bot/guilds/:guildId/meta` | `{ name, icon, channels:[{id,name,type,parentId}], roles:[{id,name,color,position,managed}] }` – the bot reports what the panel may offer; sent on join, on channel/role changes (debounced) and every 10 min |
| DELETE | `/bot/guilds/:guildId` | bot left the guild |
| GET | `/bot/changes?since=<ms>` | `{ now, guilds:[guildId…] }` – guilds whose config changed after `since` (bot polls every 15 s and reloads those) |
| POST | `/bot/guilds/:guildId/events` | `{ type, data }` – optional audit/stat events shown in the panel (`member_join`, `mod_action`, `ticket_open` …), max 100/min per guild |

Panel → API (cookie session after OAuth2):

| method | path | |
|---|---|---|
| GET | `/auth/discord/login` → Discord → `/auth/discord/callback` | sets `__Host-nore_s` (signed, httpOnly, SameSite=Lax) |
| POST | `/auth/logout` | |
| GET | `/me` | `{ user, guilds:[{id,name,icon,manageable,botPresent}] }` |
| GET | `/panel/guilds/:guildId` | `{ meta, config, version, updatedAt, events:[…last 50] }` – 403 unless the user can manage it |
| PUT | `/panel/guilds/:guildId/config` | `{ config, version }` → `{ version }`; 409 on version conflict; 400 with JSON-pointer errors when the schema rejects it |

Config writes (panel `PUT`, bot `PATCH`) bump `version`; the bot applies a config only when its
`version` is newer than the one it has.

### Who owns which change

* The panel saves whole configs (`PUT`, optimistic locking with `version`).
* The bot never keeps its own changes only locally: whatever the builder wires (channels, roles,
  enabled modules, ticket panels …), what `/config set|reset|import` changes and what panel actions
  produce is first kept as a local override (so it works at once, also offline) and then sent with
  `PATCH /bot/guilds/:id/config` (debounced ~1.5 s, and awaited at the end of a builder run). The
  answer becomes the bot's remote copy and the sent overrides are dropped. When the API is down the
  overrides stay in the bot's store and are sent on the next successful poll, on reconnect and after
  a restart (before the guild's config is loaded).
* A panel saved on an older version after the bot's `PATCH` gets `409` and reloads; an open panel with
  no unsaved edits picks up a newer version by itself (event poll, 20 s; 8 s while actions wait).

## Public API v2 (also used by the bot's commands)

`/api/v2` is the new public API; `/api/v1` stays unchanged for existing launchers and mods. v2 adds at
least: `status`, `releases`, `releases/latest`, `downloads`, `events` (with countdowns), `news`,
`platforms`, `players/:name` (Nore Hub lookup: Nore user, verified, online, wardrobe),
`servers/:address` (Minecraft server ping: online, players, version, MOTD, favicon), `stats`
(downloads, Nore players online/known), with ETag, CORS and OpenAPI at `/api/v2/openapi.json`.

## Implementation notes (Worker, `web/src/v2/`)

* Every JSON answer has an envelope: success `{ "ok": true, ...fields }` (the fields above sit at the
  top level), error `{ "ok": false, "status", "code", "error" }` with a Polish `error` message.
  Exceptions without envelope: `/api/v2/openapi.json`, `/api/v2/bot/config.schema.json`.
* `updatedAt` / `metaAt` / event `at` are ISO 8601 strings (`null` when never saved); `/bot/changes`
  `now` is milliseconds – pass it back as the next `since`.
* `GET /bot/guilds/:id/config` returns the stored config with schema defaults filled in and fields
  the schema no longer knows dropped; `version` is 0 when never saved.
* `POST /bot/guilds/:id/events` → `201 { id, at }`; over 100/min per guild → `429` with `Retry-After`.
  `type` matches `^[a-z][a-z0-9_.:-]{0,47}$`, `data` is an object of at most 4 KB. The newest 500
  events per guild are kept; the panel saves its own `panel_config_saved` events.
* `PUT /bot/guilds/:id/meta`: `name` required; channels `{ id, name, type (number or string),
  parentId, position? }`, roles `{ id, name, color, position, managed }`; unknown fields are dropped.
  `DELETE /bot/guilds/:id` of an unknown guild → 404.
* Public lookups used by the bot: `GET /players/:name` → `{ player: { name, nore, … } }`,
  `GET /servers/:address` → `{ server: { online, players, version, motd, favicon, latencyMs, … } }`
  (offline is 200 with `online: false`, private addresses 403, 429 over 20/min per IP),
  `GET /releases/latest` → `{ release }`, `GET /stats` has `online` / `known` at the top level.
* `PATCH /bot/guilds/:id/config`: `config` is merged into the stored config like RFC 7386 – objects key
  by key, arrays and scalars replace, `null` removes the key so its schema default applies. The result
  (defaults filled in) must pass the schema: otherwise `400 { code: "invalid_config", errors }` (JSON
  pointers) and nothing is saved. `updatedBy` is `{ id: "bot", name: "Nore Bot", bot: true, userId?,
  reason? }` (`by.id` = the Discord user who triggered it, `reason` matches `^[a-z][a-z0-9_.:-]{0,39}$`,
  e.g. `builder`, `command`, `action`). Without `baseVersion` a concurrent save is retried on the new
  version (field-level last write wins); with `baseVersion` a different current version is `409
  version_conflict` with the current `version`. Every save adds a `bot_config_saved` event
  `{ version, by }`, and the guild shows up in `/bot/changes`. Works for guilds without a saved
  config (version 0 → 1).
* Panel `PUT` errors: 400 `{ code: "invalid_config", errors: [{ path, pointer, message, keyword }] }`
  (JSON pointers), 409 `{ code: "version_conflict", version, updatedAt, updatedBy }`.
