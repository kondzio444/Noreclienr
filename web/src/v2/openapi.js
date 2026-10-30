/* OpenAPI 3.1 description of API v2 (served at /api/v2/openapi.json). */
import { API2_VERSION } from './http.js';

const s = { type: 'string' }, i = { type: 'integer' }, b = { type: 'boolean' }, n = { type: 'number' };
const ns = { type: ['string', 'null'] }, ni = { type: ['integer', 'null'] };
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const arr = (items) => ({ type: 'array', items });
const ok = (description, props) => ({ description, content: { 'application/json': { schema: { allOf: [ref('Ok'), obj(props)] } } } });
const err = (description) => ({ description, content: { 'application/json': { schema: ref('Error') } } });
const E = {
  400: err('Złe dane wejściowe'), 401: err('Brak lub zła autoryzacja'), 403: err('Brak uprawnień'), 404: err('Nie znaleziono'),
  405: err('Zła metoda'), 409: err('Konflikt wersji'), 413: err('Za duże żądanie'), 415: err('Zły Content-Type'), 429: err('Za dużo zapytań'),
  502: err('Błąd usługi zewnętrznej'), 503: err('Usługa niedostępna lub nieskonfigurowana'),
};
const pick = (...codes) => Object.fromEntries(codes.map(c => [c, E[c]]));
const NOT_MODIFIED = { 304: { description: 'Bez zmian (If-None-Match zgadza się z ETag)' } };
const q = (name, schema, description, required = false) => ({ name, in: 'query', required, schema, ...(description ? { description } : {}) });
const p = (name, schema, description) => ({ name, in: 'path', required: true, schema, ...(description ? { description } : {}) });
const guildId = p('guildId', { type: 'string', pattern: '^\\d{17,20}$' }, 'Identyfikator serwera Discord');
const botSec = [{ botSecret: [] }], sessSec = [{ session: [] }];

export function openapi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Nore Client API v2',
      version: API2_VERSION,
      description: 'Publiczne API Nore Client: wydania, pobrania, wydarzenia, aktualności, Nore Hub, ping serwerów Minecraft oraz API Nore Bota i panelu. '
        + 'Każda odpowiedź JSON to obiekt: sukces { ok: true, … }, błąd { ok: false, status, code, error, errors? }. Odpowiedzi GET mają ETag (If-None-Match → 304). '
        + 'Publiczne ścieżki mają otwarty CORS; /servers ma limit 20 zapytań na minutę na IP. API v1 (/api/v1) działa bez zmian.',
    },
    servers: [{ url: 'https://noreclient.pl' }, { url: 'https://noreclient.pl' }],
    tags: [{ name: 'public' }, { name: 'bot', description: 'Nore Bot → API (Authorization: Bot <NORE_BOT_SECRET>)' }, { name: 'panel', description: 'Panel na stronie (sesja po logowaniu Discord)' }],
    components: {
      securitySchemes: {
        botSecret: { type: 'apiKey', in: 'header', name: 'Authorization', description: 'Bot <NORE_BOT_SECRET>' },
        session: { type: 'apiKey', in: 'cookie', name: '__Host-nore_s', description: 'Podpisane ciasteczko sesji po /api/v2/auth/discord/callback' },
      },
      schemas: {
        Ok: obj({ ok: { const: true } }, ['ok']),
        Error: obj({ ok: { const: false }, status: i, code: s, error: { ...s, description: 'Komunikat po polsku' }, errors: arr(ref('SchemaError')), retryAfter: i, version: i }, ['ok', 'status', 'code', 'error']),
        SchemaError: obj({ path: { ...s, description: 'JSON Pointer do pola, np. /welcome/channel' }, pointer: s, message: s, keyword: s }, ['path', 'message']),
        Asset: obj({ name: s, size: i, url: s, digest: ns, downloads: i }),
        Release: obj({ version: s, name: s, prerelease: b, published: s, url: s, downloads: i, notes: s, assets: obj({ win: ref('Asset'), linux: ref('Asset'), mac: ref('Asset'), macZip: ref('Asset') }), mods: arr(ref('Asset')) }),
        Countdown: { type: ['object', 'null'], properties: { kind: { enum: ['start', 'peak', 'end'] }, at: s, seconds: i, days: i, hours: i, minutes: i } },
        Event: obj({ id: s, name: s, season: { enum: ['halloween', 'winter'] }, forced: b, active: b, accent: s, features: arr(s), startsAt: ns, endsAt: ns, peakAt: ns, countdown: ref('Countdown') }),
        Player: obj({ name: s, nore: b, uuid: s, noreId: s, verified: b, online: b, seen: i, seenAt: s, wardrobe: arr(obj({ slot: s, id: s, variant: s, color: s })), cosmetics: { type: 'object' } }, ['name', 'nore']),
        Server: obj({
          address: s, host: s, port: i, ip: s, srv: { type: ['object', 'null'], properties: { target: s, port: i } }, online: b, protocol: { enum: ['modern', 'legacy'] }, latencyMs: i,
          version: obj({ name: s, protocol: i }), players: obj({ online: i, max: i, sample: arr(obj({ name: s, id: s })) }),
          motd: obj({ raw: { ...s, description: 'Tekst z kodami §' }, clean: s, lines: arr(s), html: { ...s, description: 'Bezpieczny HTML z kolorami' } }),
          favicon: { ...ns, description: 'data:image/png;base64,… (pomijane z ?favicon=false)' }, faviconUrl: ns, mods: { type: ['object', 'null'], properties: { type: s, count: i } },
          enforcesSecureChat: b, previewsChat: b, code: { ...s, description: 'Gdy offline: dns_not_found, refused, timeout, bad_response…' }, error: s, checkedAt: s,
        }, ['address', 'host', 'port', 'online', 'checkedAt']),
        Component: obj({ status: { enum: ['ok', 'stale', 'unknown', 'error', 'down', 'disabled'] }, ms: i, error: s }),
        GuildMeta: obj({
          name: s, icon: ns, memberCount: i,
          channels: arr(obj({ id: s, name: s, type: { type: ['integer', 'string'] }, parentId: ns, position: i }, ['id'])),
          roles: arr(obj({ id: s, name: s, color: i, position: i, managed: b }, ['id'])),
        }, ['name']),
        GuildEvent: obj({ id: i, type: s, data: { type: 'object' }, at: s }),
        PanelGuild: obj({ id: s, name: s, icon: ns, iconUrl: ns, owner: b, manageable: b, botPresent: b, inviteUrl: s }),
      },
    },
    paths: {
      '/api/v2': { get: { tags: ['public'], summary: 'Lista endpointów', responses: { 200: ok('Lista', { api: s, version: s, endpoints: arr(obj({ method: s, path: s, about: s })) }) } } },
      '/api/v2/openapi.json': { get: { tags: ['public'], summary: 'Ten dokument (bez koperty ok)', responses: { 200: { description: 'OpenAPI 3.1' } } } },
      '/api/v2/status': { get: {
        tags: ['public'], summary: 'Stan API i komponentów',
        responses: { 200: ok('Stan', { status: { enum: ['ok', 'degraded', 'down'] }, service: s, time: s, colo: ns, latest: ns, hub: { type: ['object', 'null'], properties: { online: i, known: i } }, components: { type: 'object', additionalProperties: ref('Component') } }), ...NOT_MODIFIED },
      } },
      '/api/v2/releases': { get: {
        tags: ['public'], summary: 'Ostatnie wydania',
        parameters: [q('limit', { type: 'integer', minimum: 1, maximum: 30, default: 10 }), q('prerelease', { type: 'boolean', default: true }, 'false = bez wersji testowych'), q('notes', { type: 'boolean', default: false }, 'true = z opisem zmian')],
        responses: { 200: ok('Lista', { count: i, releases: arr(ref('Release')) }), ...NOT_MODIFIED, ...pick(404, 502) },
      } },
      '/api/v2/releases/latest': { get: { tags: ['public'], summary: 'Najnowsze wydanie', parameters: [q('prerelease', { type: 'boolean', default: true })], responses: { 200: ok('Wydanie', { release: ref('Release') }), ...NOT_MODIFIED, ...pick(404, 502) } } },
      '/api/v2/releases/{version}': { get: { tags: ['public'], summary: 'Jedno wydanie', parameters: [p('version', s, 'np. 1.5.0 albo v1.5.0')], responses: { 200: ok('Wydanie', { release: ref('Release') }), ...pick(404, 502) } } },
      '/api/v2/downloads': { get: {
        tags: ['public'], summary: 'Pliki najnowszego wydania i liczniki',
        responses: { 200: ok('Pobrania', {
          version: s, published: s, prerelease: b, mods: arr(ref('Asset')),
          platforms: arr(obj({ id: { enum: ['win', 'linux', 'mac', 'mac-zip'] }, name: s, available: b, href: s, file: ns, size: ni, digest: ns, url: ns, downloads: obj({ latest: i, allReleases: i, redirects: ni }) })),
          totals: obj({ github: i, redirects: ni }), daily: { type: ['array', 'null'], items: obj({ day: s, n: i }) }, note: s,
        }), ...NOT_MODIFIED, ...pick(404, 502) },
      } },
      '/api/v2/downloads/{platform}': { get: { tags: ['public'], summary: 'Przekierowanie do instalatora (liczone)', parameters: [p('platform', { enum: ['win', 'linux', 'mac', 'mac-zip'] })], responses: { 302: { description: 'Do pliku w GitHub Releases' }, ...pick(404, 502) } } },
      '/api/v2/events': { get: {
        tags: ['public'], summary: 'Wydarzenia z odliczaniem',
        responses: { 200: ok('Wydarzenia', { now: s, active: arr(s), flags: obj({ halloween: b, winter: b }), next: { type: ['object', 'null'], properties: { id: s, countdown: ref('Countdown') } }, events: arr(ref('Event')) }), ...NOT_MODIFIED },
      } },
      '/api/v2/news': { get: { tags: ['public'], summary: 'Aktualności', parameters: [q('limit', { type: 'integer', minimum: 1, maximum: 50, default: 20 }), q('tag', s, 'np. Launcher')], responses: { 200: ok('Aktualności', { count: i, tags: arr(s), news: arr(obj({ id: s, date: s, title: s, text: s, tag: s })) }), ...NOT_MODIFIED } } },
      '/api/v2/platforms': { get: {
        tags: ['public'], summary: 'Obsługiwane wersje i platformy',
        responses: { 200: ok('Platformy', { platforms: arr(obj({ name: s, loader: s, java: i, versions: arr(s) })), minecraft: arr(s), loaders: arr(s), downloads: arr(obj({ id: s, name: s, href: s })) }), ...NOT_MODIFIED },
      } },
      '/api/v2/players/{name}': { get: {
        tags: ['public'], summary: 'Nore Hub: gracz', parameters: [p('name', { type: 'string', pattern: '^[A-Za-z0-9_]{2,16}$' })],
        responses: { 200: ok('Gracz (nore: false, gdy nie używa Nore)', { player: ref('Player') }), ...NOT_MODIFIED, ...pick(400, 503) },
      } },
      '/api/v2/servers/{address}': { get: {
        tags: ['public'], summary: 'Ping serwera Minecraft (Server List Ping)',
        description: 'Nowy protokół (1.7+) z zapasowym starszym (0xFE). Bez portu sprawdzany jest rekord SRV _minecraft._tcp. Adresy prywatne i lokalne są blokowane. Wynik w pamięci 30 s; limit 20 zapytań na minutę na IP (Retry-After). Offline to też 200 z online: false.',
        parameters: [p('address', s, 'host, host:port albo [IPv6]:port (zakodowane w URL)'), q('favicon', { type: 'boolean', default: true }, 'false = bez ikony w JSON')],
        responses: { 200: ok('Wynik', { server: ref('Server') }), ...NOT_MODIFIED, ...pick(400, 403, 429) },
      } },
      '/api/v2/servers/{address}/favicon': { get: { tags: ['public'], summary: 'Ikona serwera', parameters: [p('address', s)], responses: { 200: { description: 'PNG', content: { 'image/png': {} } }, ...pick(400, 403, 404, 429) } } },
      '/api/v2/stats': { get: {
        tags: ['public'], summary: 'Statystyki',
        responses: { 200: ok('Statystyki', {
          releases: ni, latest: { type: ['object', 'null'] }, downloads: { type: ['object', 'null'], properties: { total: i, win: i, linux: i, mac: i, mods: i } },
          redirects: { type: ['object', 'null'] }, hub: { type: ['object', 'null'], properties: { online: i, known: i } }, online: ni, known: ni,
          bot: { type: ['object', 'null'], properties: { guilds: i, configured: i } }, schema: obj({ version: ni, placeholder: b }),
        }), ...NOT_MODIFIED },
      } },
      '/api/v2/bot/config.schema.json': { get: { tags: ['public', 'bot'], summary: 'JSON Schema konfiguracji Nore Bota (bez koperty ok)', responses: { 200: { description: 'JSON Schema 2020-12' } } } },
      '/api/v2/bot/guilds/{guildId}/config': { get: {
        tags: ['bot'], security: botSec, summary: 'Konfiguracja serwera (domyślna, gdy nigdy nie zapisana: version 0)', parameters: [guildId],
        responses: { 200: ok('Konfiguracja', { guildId: s, version: i, updatedAt: ns, config: { type: 'object' } }), ...pick(400, 401, 503) },
      }, patch: {
        tags: ['bot'], security: botSec, parameters: [guildId],
        summary: 'Bot zapisuje to, co sam zmienił (kreator, /config, akcje panelu): część konfiguracji scalana z zapisaną',
        description: 'Obiekty są scalane pole po polu, listy i wartości proste zastępowane, null przywraca wartość domyślną. Wynik jest sprawdzany schematem, wersja rośnie o 1, updatedBy to bot. Bez baseVersion równoległy zapis jest ponawiany na nowej wersji; z baseVersion inna bieżąca wersja daje 409.',
        requestBody: { required: true, content: { 'application/json': { schema: obj({
          config: { type: 'object', description: 'część konfiguracji (scalana)' }, baseVersion: { type: 'integer', minimum: 0 },
          by: obj({ id: s }), reason: { type: 'string', pattern: '^[a-z][a-z0-9_.:-]{0,39}$', description: 'np. builder, command, action' },
        }, ['config']) } } },
        responses: { 200: ok('Zapisano', { guildId: s, version: i, updatedAt: s, updatedBy: { type: 'object' }, config: { type: 'object' } }), ...pick(400, 401, 409, 413, 415, 503) },
      } },
      '/api/v2/bot/guilds/{guildId}/meta': { put: {
        tags: ['bot'], security: botSec, summary: 'Bot zgłasza kanały i role serwera', parameters: [guildId],
        requestBody: { required: true, content: { 'application/json': { schema: ref('GuildMeta') } } },
        responses: { 200: ok('Zapisano', { guildId: s, present: b, metaAt: s }), ...pick(400, 401, 413, 415, 503) },
      } },
      '/api/v2/bot/guilds/{guildId}': { delete: { tags: ['bot'], security: botSec, summary: 'Bot opuścił serwer', parameters: [guildId], responses: { 200: ok('Usunięto', { guildId: s, present: b }), ...pick(401, 404) } } },
      '/api/v2/bot/changes': { get: {
        tags: ['bot'], security: botSec, summary: 'Serwery, których konfiguracja zmieniła się po since', parameters: [q('since', { type: 'integer', minimum: 0 }, 'ms; następne zapytanie z poprzednim now', true)],
        responses: { 200: ok('Zmiany', { now: i, guilds: arr(s) }), ...pick(400, 401) },
      } },
      '/api/v2/bot/guilds/{guildId}/events': { post: {
        tags: ['bot'], security: botSec, summary: 'Zdarzenie do panelu (najwyżej 100/min na serwer, przechowywane ostatnie 500)', parameters: [guildId],
        requestBody: { required: true, content: { 'application/json': { schema: obj({ type: { type: 'string', pattern: '^[a-z][a-z0-9_.:-]{0,47}$' }, data: { type: 'object', description: 'najwyżej 4 KB' } }, ['type']) } } },
        responses: { 201: ok('Zapisano', { id: i, at: s }), ...pick(400, 401, 413, 429) },
      } },
      '/api/v2/auth/discord/login': { get: { tags: ['panel'], summary: 'Start logowania Discord (identify guilds)', parameters: [q('next', s, 'ścieżka na tej stronie, domyślnie /panel')], responses: { 302: { description: 'Do Discorda; ustawia __Host-nore_o' }, ...pick(503) } } },
      '/api/v2/auth/discord/callback': { get: {
        tags: ['panel'], summary: 'Powrót z Discorda', parameters: [q('code', s), q('state', s), q('error', s)],
        responses: { 302: { description: 'Do next z ciasteczkiem __Host-nore_s; przy błędzie przeglądarka wraca do next?login=<kod>' }, ...pick(400, 401, 502, 503) },
      } },
      '/api/v2/auth/logout': { post: { tags: ['panel'], security: sessSec, summary: 'Wylogowanie (unieważnia sesję)', responses: { 200: ok('Wylogowano', { loggedOut: b }), ...pick(403) } } },
      '/api/v2/me': { get: {
        tags: ['panel'], security: sessSec, summary: 'Zalogowany użytkownik i jego serwery',
        responses: { 200: ok('Użytkownik', { user: obj({ id: s, username: s, globalName: ns, avatar: ns, avatarUrl: ns }), guilds: arr(ref('PanelGuild')) }), ...pick(401, 502, 503) },
      } },
      '/api/v2/panel/guilds/{guildId}': {
        get: {
          tags: ['panel'], security: sessSec, summary: 'Konfiguracja serwera w panelu (wymaga Zarządzania serwerem, Administratora albo bycia właścicielem)', parameters: [guildId],
          responses: { 200: ok('Serwer', { guild: obj({ id: s, name: s, icon: ns, iconUrl: ns }), meta: { anyOf: [ref('GuildMeta'), { type: 'null' }] }, metaAt: ns, config: { type: 'object' }, version: i, updatedAt: ns, updatedBy: { type: ['object', 'null'] }, events: arr(ref('GuildEvent')), schema: obj({ id: ns, version: ni, url: s }) }), ...pick(400, 401, 403, 404) },
        },
        put: { tags: ['panel'], security: sessSec, summary: 'To samo co PUT …/config', parameters: [guildId], requestBody: { $ref: '#/paths/~1api~1v2~1panel~1guilds~1{guildId}~1config/put/requestBody' }, responses: { 200: ok('Zapisano', { version: i, updatedAt: s }) } },
      },
      '/api/v2/panel/guilds/{guildId}/config': { put: {
        tags: ['panel'], security: sessSec, summary: 'Zapis konfiguracji (wersjonowany)', parameters: [guildId],
        requestBody: { required: true, content: { 'application/json': { schema: obj({ config: { type: 'object' }, version: { type: 'integer', description: 'wersja, którą edytowano' } }, ['config', 'version']) } } },
        responses: { 200: ok('Zapisano', { version: i, updatedAt: s }), 400: err('Schemat odrzucił konfigurację (errors z JSON Pointer)'), 409: err('Ktoś zapisał w międzyczasie (version = aktualna)'), ...pick(401, 403, 404, 413, 415) },
      } },
    },
  };
}
