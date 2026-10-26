# Nore website + API (Cloudflare Worker)

One Worker (`src/worker.js`) serves the website and the API for **noroclient.pl**, **noreclient.pl**
and **mc.noreclient.pl** (`www.*` redirects to the apex host).

| path | what |
|---|---|
| `/api/v1/*` | API v1 – unchanged, used by released launchers and mods (`src/worker.js`) |
| `/api/v2/*` | API v2 – `src/v2/` (router `index.js`, OpenAPI at `/api/v2/openapi.json`) |
| `mc.noreclient.pl/*` | the Nore MC server site, static files from `public/mc/` (`/assets/*` is shared) |
| `/panel`, `/panel/<guildId>` | the Nore Bot panel (`public/panel/`, one page; the Worker maps `/panel/<id>` to it) |
| everything else | static files from `public/` |

## Website (Album)

* Design source: `../DESIGN.md`, `../design/tokens.json`. `scripts/copy-tokens.mjs` (build step) copies the
  generated `design/tokens.css` to `public/assets/tokens.css`.
* Shared by every host: `public/assets/album.css` + `album.js` (API helper, entrances, the seasonal event:
  Halloween torch 15.10 – 3.11, winter snow from 10.12), fonts in `public/assets/fonts/` (Dela Gothic One,
  Onest, Pixelify Sans – woff2 latin + latin-ext, SIL OFL 1.1, licences beside them; CSP `font-src 'self'`).
* Pages: `index.html` (+ `style.css`, `app.js`), `api.html` (rendered from `/api/v2/openapi.json`, v1 table from
  `/api/v1/openapi.json`), `mc/` (Nore MC: live `/api/v2/servers/mc.noreclient.pl`), `panel/` (forms rendered
  only from `/api/v2/bot/config.schema.json`, labels from `panel/locales/{pl,en}.json`).
* Gates: `node ../.claude/skills/taste-skill/scripts/lint.mjs public` and `inspect.mjs <url> --allow palette-purple`
  (violet is the brand) on `/`, `/api` and the mc host.

## API v2 in short

* Envelope: success `{ "ok": true, ...fields }`, error `{ "ok": false, "status", "code", "error", "errors"? }`
  (Polish messages). GET answers carry an `ETag` (`If-None-Match` → 304).
* Public: `status`, `releases`, `releases/latest`, `releases/:version`, `downloads`,
  `downloads/:platform` (302, counted), `events`, `news`, `platforms`, `players/:name`,
  `servers/:address` (+ `/favicon`), `stats`, `bot/config.schema.json`, `openapi.json`. CORS `*`.
* `servers/:address`: Minecraft Server List Ping from the Worker (`cloudflare:sockets`): modern status
  + ping, legacy 0xFE fallback, SRV via DNS-over-HTTPS, private/loopback targets refused (403),
  30 s cache, 20 pings/min per IP (`SLP_LIMIT` rate-limit binding).
* Nore Bot (`bot/*`, header `Authorization: Bot <NORE_BOT_SECRET>`) and the panel (`auth/*`, `me`,
  `panel/guilds/:id`) follow `docs/bot-api.md`.

## Bindings and migrations (`wrangler.jsonc`)

* Durable Objects (SQLite): `HUB` → `NoreHub` (migration `hub-v1`), `BOT` → `NoreBot` and
  `COUNTERS` → `NoreCounters` (migration `bot-v1`).
* Rate limit: `SLP_LIMIT` (namespace 4201, 20 / 60 s).
* `run_worker_first: true` (host routing needs the Worker in front of the static files).
* Custom domains `noreclient.pl`, `www.noreclient.pl`, `mc.noreclient.pl` need the zone
  `noreclient.pl` active on Cloudflare (nameservers) before the deploy can attach them.

## Secrets (never in git)

```sh
npx wrangler secret put NORE_BOT_SECRET       # ≥ 16 chars, same value as NORE_BOT_SECRET in discord-bot/.env
npx wrangler secret put SESSION_KEY           # ≥ 32 random chars, signs the panel session cookie
npx wrangler secret put DISCORD_CLIENT_ID     # the Nore Bot application (OAuth2)
npx wrangler secret put DISCORD_CLIENT_SECRET
# already used by API v1: MS_CLIENT_ID, CF_API_KEY, optional GITHUB_TOKEN
```

In the Discord developer portal add the OAuth2 redirects
`https://noroclient.pl/api/v2/auth/discord/callback` and `https://noreclient.pl/api/v2/auth/discord/callback`
(the redirect is built from the host the panel is opened on). Without these secrets the related
routes answer 503 with an explanation; everything else keeps working.

Rotating `SESSION_KEY` logs everybody out of the panel; rotating `NORE_BOT_SECRET` needs the same
value in the bot.

## Bot schema

`src/bot-schema.json` is the bot's `discord-bot/config.schema.json`, copied by
`scripts/copy-bot-schema.mjs` (wrangler `build` step, or `npm run build:schema`; it also copies
`discord-bot/locales/*.json` to `public/panel/locales/`). Until the bot's file exists a small
placeholder schema (`"x-placeholder": true`) is committed. The validator (`src/v2/schema.js`)
supports type, enum, const, properties, required, additionalProperties, items, min/maxItems,
uniqueItems, minimum/maximum, min/maxLength, pattern, default and local `$ref`.

## Develop and test

```sh
npm ci
npm test          # wrangler dev + fake GitHub / Discord / DNS / Minecraft servers, ~1 min
npm run bundle    # minified bundle in dist/wr (wrangler deploy --dry-run), no deploy
```

Test-only variables (never set in production): `GITHUB_API`, `DISCORD_API`, `DISCORD_AUTHORIZE`,
`DOH_URL`, `SLP_ALLOW_IPS`, `TEST_HOST_HEADER`, `PANEL_ORIGINS`, `MOJANG_SESSION`.
`scripts/test/v1-golden.json` is the recorded API v1 output; `npm test` fails if v1 changes
(`node scripts/test/v1-dump.mjs <file>` records a new one).
