# Integracja Nore Bota z serwerem Minecraft (np. MC.noreclient.pl)

Bot udostępnia małe API HTTP, które woła plugin na serwerze Minecraft (Paper/Spigot/Velocity – dowolny
język, wystarczy klient HTTP). Daje ono:

* **most czatu** Minecraft ⇄ Discord (kanał `minecraft.chatChannel`),
* **łączenie kont** Discord ↔ Minecraft jednorazowym kodem (w obie strony),
* **role z rang w grze** (`minecraft.rankRoles`: ranga → rola) i opcjonalnie pseudonim = nick z gry.

## Włączenie

1. W `discord-bot/.env` ustaw `MC_BRIDGE_PORT=8787` (i ewentualnie `MC_BRIDGE_HOST`). Jeśli plugin
   działa na innej maszynie, wystaw port przez reverse proxy z HTTPS (nginx, Caddy) albo w sieci
   prywatnej – token idzie w nagłówku, więc nie używaj gołego HTTP przez internet.
2. Na Discordzie: `/config module minecraft on`, `/config set minecraft.chatChannel #czat-minecraft`,
   `/config set minecraft.address MC.noreclient.pl`, opcjonalnie `minecraft.linkedRole`,
   `minecraft.syncNicknames`, `minecraft.rankRoles` (JSON, np. `[{"rank":"vip","role":"123…"}]`).
   Szablon kreatora `mc-server` ustawia to wszystko sam.
3. `/minecraft token` – bot pokaże token **tylko raz**. Wpisz go do konfiguracji pluginu.

Każdy serwer Discord ma własny token. Bot przechowuje tylko jego skrót SHA-256.

## Uwierzytelnienie

Każde żądanie: `Authorization: Bearer <guildId>.<secret>` (dokładnie tak, jak pokazał `/minecraft token`).
Limit: 25 żądań na sekundę na serwer. Odpowiedzi to JSON (UTF-8), błędy: `{ "error": "…" }` z kodem
401 (zły token), 403 (moduł wyłączony), 400 (złe dane), 404, 409, 413, 429.

## Endpointy

### `GET /mc/v1/ping`
Sprawdzenie połączenia → `{ "ok": true, "guild": "Nazwa serwera", "chat": true }`.

### `POST /mc/v1/chat` – gra → Discord
```json
{ "type": "chat", "player": "Steve_PL", "uuid": "0123…32 hex", "message": "Siema!" }
```
`type`: `chat` (wymaga `player` i `message`), `join`, `leave`, `death` (`message` = treść śmierci),
`advancement` (`message` = nazwa osiągnięcia), `server_start`, `server_stop`.
Wiadomości czatu trafiają przez webhook „Nore Bridge” z awatarem gracza (mc-heads.net); wzmianki są
wyłączone. Odpowiedź `{ "ok": true }`.

### `GET /mc/v1/outbox?after=<seq>` – Discord → gra
Plugin odpytuje co 1–2 s. Zwraca wiadomości napisane na kanale mostu po numerze `after`:
```json
{ "messages": [{ "seq": 42, "author": "Kondzio", "discordId": "…", "content": "Hej!", "at": 1792270000000 }], "next": 42 }
```
Zapamiętaj `next` i podaj go jako `after` w kolejnym zapytaniu. Bot trzyma ostatnie 200 wiadomości w pamięci.

### Łączenie kont – zaczynając na Discordzie
1. Gracz wpisuje `/link` na Discordzie i dostaje kod `NORE-123456` (ważny 10 minut).
2. W grze wpisuje `/discord link NORE-123456`; plugin wysyła:
```http
POST /mc/v1/link
{ "code": "NORE-123456", "uuid": "0123…", "name": "Steve_PL" }
```
→ `{ "ok": true, "discordId": "…", "discordName": "kondzio" }` albo 404 `invalid_code`.

### Łączenie kont – zaczynając w grze
```http
POST /mc/v1/link/request
{ "uuid": "0123…", "name": "Steve_PL" }
```
→ `{ "code": "NORE-654321", "expiresIn": 600 }`. Plugin pokazuje kod graczowi, a ten wpisuje na
Discordzie `/link code:NORE-654321`.

Po połączeniu bot nadaje `minecraft.linkedRole` i – gdy `syncNicknames` jest włączone – ustawia
pseudonim według `nicknameTemplate` (`{name}` = nick z gry).

### `GET /mc/v1/linked/<uuid>`
→ `{ "linked": true, "discordId": "…", "discordName": "…", "roles": ["Gracz", "VIP"] }` albo `{ "linked": false }`.

### `POST /mc/v1/ranks` – rangi → role
```json
{ "uuid": "0123…", "ranks": ["vip", "builder"] }
```
Bot nadaje role z `minecraft.rankRoles`, których ranga jest na liście, i zdejmuje pozostałe z tej
listy → `{ "ok": true, "added": ["…"], "removed": ["…"] }`. Wywołuj przy wejściu gracza i przy zmianie rangi.
404 `not_linked`, gdy konto nie jest połączone.

## Przykład (Java, Paper, `java.net.http`)

```java
HttpClient http = HttpClient.newHttpClient();
String token = getConfig().getString("nore.token"); // z /minecraft token
URI base = URI.create(getConfig().getString("nore.url")); // np. https://bot.noroclient.pl

void chat(Player p, String msg) {
  JsonObject json = new JsonObject(); // com.google.gson (bundled with Paper)
  json.addProperty("type", "chat");
  json.addProperty("player", p.getName());
  json.addProperty("uuid", p.getUniqueId().toString().replace("-", ""));
  json.addProperty("message", msg);
  String body = json.toString();
  HttpRequest req = HttpRequest.newBuilder(base.resolve("/mc/v1/chat"))
      .header("Authorization", "Bearer " + token).header("Content-Type", "application/json")
      .POST(HttpRequest.BodyPublishers.ofString(body)).build();
  http.sendAsync(req, HttpResponse.BodyHandlers.discarding());
}
```

## Status serwera

Niezależnie od pluginu bot sprawdza status serwera protokołem Server List Ping (API v2
`/api/v2/servers/:address`, a gdy nie odpowiada – bezpośrednio z bota): `/mc server`,
monitory `status.servers` (powiadomienia online/offline, wiadomość ze statusem na żywo co minutę)
i tablica statusu.

## Sharding

Most HTTP działa w procesie shardu 0 (albo w jedynym procesie, gdy bot nie jest shardowany –
to typowy przypadek poniżej ~2000 serwerów). Serwery Discord obsługiwane przez inne shardy dostaną
401 – przy shardowaniu uruchom osobną instancję bota dla serwera z integracją.
