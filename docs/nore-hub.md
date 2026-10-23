# Nore Hub – who else plays with Nore

Nore Hub is a small directory on the Nore website worker that answers one question for the game:
"which of the players around me also use Nore, and what do they wear?". It powers the Nore mark in
the tab list, other players' wardrobe items (wings, hats, ears…), and the player menu (message /
add friend) when the player under the crosshair is a Nore user.

Base URL: `https://noroclient.pl` (override in the game with `-Dnoreclient.hub=<url>`,
in the launcher with the `NORE_HUB` env var). All JSON, UTF-8.

## Identity

* Every launcher already has a Nore ID: an ECDSA P-256 key pair (launcher/src/main/chat.js); the
  ID is `sha256(spki public key)` → first 20 hex chars (`hex`), shown as `NORE-XXXXX-…`.
* A Minecraft account is bound to a Nore ID by the launcher when it starts the game.
  * Premium: the launcher calls Mojang `POST https://sessionserver.mojang.com/session/minecraft/join`
    with the account's access token and a random `serverId`; the worker checks
    `GET https://sessionserver.mojang.com/session/minecraft/hasJoined?username=&serverId=` and
    requires the returned id to equal `uuid`. Entry is `verified: true`.
  * Non-premium: no Mojang proof; entry is `verified: false`. First come first served: an
    unverified name stays bound to the Nore ID that claimed it while that entry was seen in the
    last 30 days; a verified premium claim always wins.

## Endpoints (worker)

### `POST /api/v1/hub/hello` – launcher only, also the heartbeat (every 60 s while the game runs)

```json
{
  "name": "Steve_PL", "uuid": "0123…(32 hex, no dashes)", "premium": true, "serverId": "…",
  "hex": "20 hex chars", "pub": "base64 SPKI DER of the P-256 key", "ts": 1792270000000,
  "online": true,
  "cosmetics": { … see Cosmetics … },
  "sig": "base64 DER ECDSA-SHA256 over the canonical string"
}
```

Canonical string (UTF-8): `nore-hub/1|<name>|<uuid>|<hex>|<ts>|<online ? 1 : 0>|<sha256 hex of JSON.stringify(cosmetics)>`.

Checks: `hex == sha256(pub)[0:20]`, signature valid, `|now - ts| < 5 min`, name `^[A-Za-z0-9_]{2,16}$`,
uuid 32 hex, cosmetics valid (below), at most one hello per `hex` per 15 s (429 otherwise),
`serverId` only checked when `premium` (and only on the first hello of a session or when the stored
entry is not yet verified – later heartbeats are signature-only).

Response `200 { ok, verified, name }`, errors `{ error, status }` (400 / 401 / 409 name taken / 429).
`online: false` marks the player offline immediately (game closed).

### `GET /api/v1/hub/players?names=a,b,c` – the game (no auth)

Up to 100 names (case-insensitive). Returns only Nore users:

```json
{ "players": { "steve_pl": { "name": "Steve_PL", "uuid": "…", "hex": "…", "verified": true,
  "online": true, "seen": 1792270000000, "cosmetics": { … } } } }
```

Keys are lowercase names. `online` = a hello in the last 3 minutes. `Cache-Control: max-age=20`.

### `GET /api/v1/hub/stats` → `{ online, known }`

## Cosmetics (opaque to the worker, owned by the mod's wardrobe)

```json
{ "v": 1, "slots": { "<slot>": { "id": "bat_wings", "color": 16711935, "variant": "classic",
  "opts": { "speed": 1.0, "scale": 1.0, "glow": true } } } }
```

Worker validation only: object; `v` integer; at most 10 slots; slot keys and `id` / `variant`
match `^[a-z0-9_]{1,32}$`; `color` integer 0..0xFFFFFF; `opts` at most 12 keys `^[a-z0-9_]{1,24}$`,
values number / boolean / string ≤ 32 chars; whole `JSON.stringify(cosmetics)` ≤ 2048 bytes.
The mod (`dev.noreclient.cosmetic.Wardrobe`) writes and reads it and ignores what it does not know.

## Game ↔ launcher bridge additions (127.0.0.1, see launcher/src/main/chat-bridge.js)

* `POST /v1/presence { cosmetics }` – the game's current wardrobe; the launcher includes it in the
  next hello (and sends one within 2 s when it changed).
* `POST /v1/contacts/add { hex, name }` – add a Nore user as a chat contact (sends the invitation
  through the normal chat transport). Response `{ ok, contact }`.
* `POST /v1/contacts/remove { hex }` and `POST /v1/requests/decline { hex, block? }` – remove a chat
  contact / decline an invitation from the game.
* `GET /v1/state` additionally returns `me: { hex, id, name }` (already) and `requests: [...]`.

Without the launcher (no `-Dnoreclient.chatBridge`) the game still reads `/api/v1/hub/players`
(it sees other Nore users) but does not publish itself.
