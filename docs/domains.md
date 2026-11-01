# Official Nore domains – `<name>.noreclient.pl`

Free, official addresses for Minecraft servers of Nore players (servers hosted with Nore Launcher
and any other player with a Nore ID). The Nore API keeps who owns which name and writes the DNS
records on the `noreclient.pl` zone through the Cloudflare API.

| Piece | Where |
|---|---|
| Routes, names, signatures, admin routes | `web/src/v2/domains.js` |
| State (owners, targets, record ids, reservations, official record, replay + rate counters) | `NoreDomains` Durable Object, `web/src/v2/domains-store.js` (binding `DOMAINS`, migration `domains-v1`) |
| Cloudflare DNS client with the strict allowlist | `web/src/v2/cfdns.js` |
| Launcher client (signing, provider "Nore") | `launcher/src/main/nore-domains.js`, `servers.js`, `server-net.js` |
| Tests | `web/scripts/v2-test.mjs` (fake Cloudflare API in `web/scripts/test/fakes.mjs`), `launcher/test/nore-domains.test.js` |

## Setup (owner)

1. Cloudflare dashboard → My Profile → API Tokens → **Create token** → *Custom token*:
   * Permissions: **Zone → DNS → Edit** (nothing else; Zone → Zone → Read is not needed).
   * Zone Resources: **Include → Specific zone → noreclient.pl**.
   * Optional: Client IP filtering is not possible (Workers egress IPs vary); set a TTL / rotate yearly.
2. `cd web && npx wrangler secret put CF_DNS_TOKEN` (the token) and `npx wrangler secret put CF_ZONE_ID`
   (noreclient.pl → Overview → API → Zone ID; it may also be a plain `vars` entry).
3. Deploy. The migration `domains-v1` creates the `NoreDomains` object; the rate limit binding
   `DOMAIN_LIMIT` (namespace 4202) limits writes to 60 per minute per IP.

Without `CF_DNS_TOKEN` / `CF_ZONE_ID` every write answers `503 domains_disabled`
("Domeny Nore są chwilowo wyłączone – administrator nie skonfigurował jeszcze dostępu do DNS …");
lookups keep working and `GET /api/v2/domains` says `enabled: false`. A token without access answers
503 too (logged in the Worker).

Optional vars: `DOMAINS_MAX_PER_ID` (3), `DOMAINS_EXPIRY_DAYS` (60), `DOMAINS_CLAIMS_PER_HOUR` (5 per IP),
`DOMAINS_CLAIMS_PER_DAY` (10 per Nore ID), `DOMAINS_UPDATES_PER_HOUR` (60 per name), `DOMAINS_ZONE`
(noreclient.pl). `CF_API` and `TEST_CLOCK` are for tests only.

## Records

| Target sent | Records created (all **DNS only**, TTL 60, comment `nore-domain:<name>`) |
|---|---|
| IPv4, port 25565 | `A <name>.noreclient.pl → IP` |
| IPv4 / IPv6, other port | `A`/`AAAA` + `SRV _minecraft._tcp.<name>.noreclient.pl 0 5 <port> <name>.noreclient.pl` |
| host name (e.g. playit.gg `abc.joinmc.link`) | `CNAME <name>.noreclient.pl → host` + SRV straight to `host:port` when the port is not 25565 (an SRV target must not be an alias) |

Players always type just `<name>.noreclient.pl`.

**Strict allowlist** – the Worker only ever changes or deletes a record when
1. its id was stored by `NoreDomains` when the Worker created it,
2. its name is `<name>.noreclient.pl` or `_minecraft._tcp.<name>.noreclient.pl` (never the apex,
   `www` or `mc` itself), and
3. its comment on Cloudflare is still exactly `nore-domain:<name>`.

Anything else stops the operation with `409 foreign_record`. New records are only created when no
other record has that name (`409 name_in_use`), so names somebody added by hand are safe.
(Comments, not tags: DNS record tags are not on every plan.)

## Names

3–32 characters `a–z 0–9 -`, no hyphen at the start / end, no `--`, not only digits. Reserved:
service names (`www mc api panel admin mail status play launcher bot cdn dev staging noreclient nore …`,
full list: `RESERVED` in `domains.js` or `GET /api/v2/admin/domains/reserved`) plus names admins
reserve. A basic filter refuses profanity (PL + EN, simple leetspeak undone) and impersonation
(`nore…client/launcher/team/staff`, `official`, `oficjal`, `admin…`, `support`, `mojang`, `microsoft`,
`login`, `verify` …). At most **3 names per Nore ID**. Blacklisted Nore IDs (`nore_id` entries of the
admin blacklist) cannot claim or change names.

**Expiry**: a name nobody refreshed for 60 days is removed (DNS first, then the row) by the cron
(`scheduled`, at most once an hour). Every signed `PUT` refreshes it – the launcher sends one on every
server start, so a used server never expires. `expiresAt` is in every answer.

## Signature (Nore ID)

The launcher's chat identity (`launcher/src/main/chat.js`, ECDSA P-256 – the same key Nore Hub uses).

```
nore-domains/1|<op>|<name>|<hex>|<ts>|sha256hex(JSON.stringify(target ?? null))
op  = claim | update | release | mine     (name is "" for mine)
hex = first 20 hex chars of sha256(SPKI DER public key)   (the Nore ID)
sig = DER ECDSA signature, base64        ts = ms, |now − ts| < 5 min, strictly increasing per Nore ID
```

Body: `{ hex, pub, ts, sig, target? }` with `target = { address, port }`. Errors: `400 bad_signature`
(missing / malformed), `401 bad_signature` (wrong key / signature / key not matching hex),
`401 bad_clock`, `401 replay`.

## Public API

| Method | Path | |
|---|---|---|
| GET | `/api/v2/domains` | zone, `enabled`, limits, rules |
| GET | `/api/v2/domains/{name}` | `{ valid, available, reason: invalid\|reserved\|blocked_word\|impersonation\|taken, message, domain }` – for checking while typing; a taken name shows its target (not the owner) |
| POST | `/api/v2/domains/{name}` | claim (`op claim`, optional `target`) → 201 `{ created, domain }`; again by the owner → 200 (refresh). 409 `taken` / `reserved` / `limit` / `name_in_use`, 403 `blocked`, 429 |
| PUT | `/api/v2/domains/{name}` | point at `target` (`op update`) → `{ changed, domain }`; unchanged → no DNS call, only the refresh. 403 `not_owner`, 404, 400 `private_address` / `bad_target` / `bad_port` |
| DELETE | `/api/v2/domains/{name}` | release (`op release`) → `{ released }` |
| POST | `/api/v2/domains/@mine` | my names (`op mine`) → `{ count, max, domains }` |

`domain = { name, fqdn, address, target: { type: A|AAAA|CNAME, address, port } | null, srv, state: pending|active|error, createdAt, updatedAt, refreshedAt, expiresAt }`.
Targets: public IPs only (private, loopback, CGNAT, documentation ranges refused), host names outside
`noreclient.pl`, or `"auto"` (the caller's IP as Cloudflare sees it).

## Admin API (`Authorization: Admin <ADMIN_TOKEN>`, docs/admin-api.md)

| Method | Path | |
|---|---|---|
| GET | `/api/v2/admin/domains?q=&limit=` | list / search by name, owner, address; `blocked` marks blacklisted owners; also `official` |
| GET | `/api/v2/admin/domains/{name}` | one domain with owner and Cloudflare record ids |
| DELETE | `/api/v2/admin/domains/{name}` | revoke `{ reason, reserve }` – removes the DNS, `reserve: true` keeps the name blocked |
| POST | `/api/v2/admin/domains/{name}/transfer` | `{ noreId }` (NORE-XXXXX-… or hex; blacklist and limit checked) |
| GET / POST | `/api/v2/admin/domains/reserved` | built-in + admin reservations / `{ name, reason }` |
| DELETE | `/api/v2/admin/domains/reserved/{name}` | lift a reservation |
| GET / PUT / DELETE | `/api/v2/admin/domains/official` | the official Nore MC record (below) |
| POST | `/api/v2/admin/domains/cleanup` | run the expiry now |

Every write goes to the admin audit log (`domains.*`).

## Official Nore MC server (`mc.noreclient.pl`)

`mc.noreclient.pl` is the Worker custom domain of the Nore MC website and stays exactly as it is.
Minecraft clients look up `_minecraft._tcp.<host>` before connecting, so
`PUT /api/v2/admin/domains/official { "host": "play.example-host.net", "port": 25565 }` creates

* `SRV _minecraft._tcp.mc.noreclient.pl 0 5 <port> <host>` (comment `nore-domain:mc`), and
* for an IP host also `A`/`AAAA mc-srv.noreclient.pl → IP` (DNS only; the SRV then points there).

Players type `mc.noreclient.pl` in Minecraft and reach the game server; browsers still get the
website. The official record never expires; `DELETE` removes it again. The admin overview pings
`ADMIN_MC_SERVER` (default `mc.noreclient.pl`), which follows the SRV record.

## What to verify after deploying

1. `GET https://noreclient.pl/api/v2/domains` → `enabled: true`.
2. In the launcher: server → "Sieć i domena" → Nore → type a name → claim → start the server →
   `dig +short <name>.noreclient.pl` shows your IP; with another port
   `dig +short SRV _minecraft._tcp.<name>.noreclient.pl`.
3. In the Cloudflare dashboard the records are grey-clouded with the comment `nore-domain:<name>`.
4. Official: set the official target, `dig SRV _minecraft._tcp.mc.noreclient.pl`, open
   https://mc.noreclient.pl (website unchanged) and join `mc.noreclient.pl` in Minecraft.
