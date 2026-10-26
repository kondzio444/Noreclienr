# Nore Bot

Bot Discord społeczności **Nore Client** (klient i launcher Minecrafta, [noreclient.pl](https://noreclient.pl)).
Działa po polsku (domyślnie) i po angielsku – każdy tekst pochodzi z `locales/pl.json` / `locales/en.json`
(oraz `locales/templates/*.json` dla kreatora serwera), a prywatne odpowiedzi trafiają do członka w jego
języku Discorda.

Zwykły Node.js 22+, bez kompilacji i bez Dockera: `npm install`, potem `node .`.

## Co potrafi

| Moduł | Komendy | Co robi |
|---|---|---|
| Nore | `/nore status·download·version·news·event·player`, `/mc server`, `/status` | status usług, pobieranie (przyciski dla systemów), wersje i zmiany, aktualności, odliczanie Halloween/zimy, gracz w Nore Hub (czy gra z Nore, weryfikacja, online, szatnia, awatar z mc-heads), status dowolnego serwera MC (API v2 albo własny ping SLP), automatyczne ogłoszenia nowych wersji, aktualności i wydarzeń |
| Feedy | `/feeds add·list·remove` | YouTube (RSS, bez klucza), Twitch (Helix), TikTok/Instagram/X przez RSS-Bridge, dowolne RSS/Atom, wydania/commity GitHuba – deduplikacja, backoff, szablony wiadomości, ping roli |
| Status | `/status services·board·monitor·unmonitor` | awarie i powroty usług Nore z czasem trwania i dostępnością, monitory serwerów MC (online/offline, wiadomość na żywo co minutę), tablica statusu |
| Moderacja | `/warn`, `/warnings`, `/timeout`, `/untimeout`, `/kick`, `/ban` (też czasowy), `/unban`, `/purge`, `/case` | powody, numery spraw, kanał logów, DM do ukaranego z linkiem do odwołań, progi ostrzeżeń z automatycznymi karami, hierarchia ról |
| AutoMod | `/automod status·raidmode·native …` | spam/flood, powtórzenia, masowe wzmianki, zaproszenia, linki spoza listy, wulgaryzmy (z polskimi znakami i leetspeakiem), caps lock, filtr nowych kont, tryb raidu z wykrywaniem fali wejść; zarządzanie natywnym AutoModem Discorda |
| Powitania | `/welcome test` | powitanie/pożegnanie (szablony, embed, grafika z awatarem), DM, autorole |
| Weryfikacja | `/verify panel` | przycisk + captcha w formularzu, rola zweryfikowanych, wyrzucanie niezweryfikowanych po czasie |
| Tickety | `/ticket …` (12 podkomend) | wiele paneli, kategorie z własnymi rolami i formularzami, priorytety, przejmowanie/przekazywanie, dodawanie osób, kanały albo prywatne wątki, zamykanie z powodem, zapis HTML do logów (i DM), ponowne otwarcie, oceny, auto-zamykanie po bezczynności z ostrzeżeniem, limity, czarna lista, statystyki (czas reakcji, oceny) |
| Propozycje | `/suggest`, `/suggestion status·top·queue·panel` | kanał lub forum, głosy przyciskami na żywo, wątek dla każdej, statusy (nowa/rozważana/zaakceptowana/odrzucona/wdrożona) z uzasadnieniem i DM, anonimowo, kategorie, odstęp, ranking, kolejka i wstępna moderacja |
| Podania | `/apply`, `/applications panel·list` | podania do ekipy, współprace (reklama partnera publikowana po akceptacji), dowolne formularze |
| Role | `/selfroles …` | menu ról: przyciski, lista wyboru, reakcje; role za poziomy |
| Poziomy | `/rank`, `/leaderboard`, `/xp …` | XP za wiadomości i rozmowy głosowe, odstęp, mnożnik, ogłoszenia awansu, role za poziomy |
| Społeczność | `/poll`, `/giveaway`, `/remind`, starboard | ankiety z przyciskami, konkursy (udział, losowanie, ponowne losowanie), przypomnienia, tablica gwiazd |
| Automatyzacja | `/cc`, `/schedule`, `/stats` | własne komendy i autoodpowiedzi, zaplanowane wiadomości (co N minut / codziennie / co tydzień, strefa czasowa), kanały statystyk |
| Logi | – | edycje i usunięcia wiadomości, wejścia/wyjścia, role, pseudonimy, bany, kanały, role serwera, ustawienia, głosowe |
| Boosty | `/boosts info·setup` | podziękowania, dodatkowa rola boostera, kanał tylko dla boosterów |
| Minecraft | `/link`, `/unlink`, `/minecraft token·status·unlink·whois` | most czatu, łączenie kont kodem, role z rang w grze – zob. [docs/minecraft-integration.md](docs/minecraft-integration.md) |
| Konfigurator | `/guild`, `/channel`, `/role`, `/perms`, `/emoji`, `/sticker`, `/event`, `/webhook`, `/template` | wszystko, na co bot ma uprawnienia: nazwa, ikona, baner, splash, opis, weryfikacja, filtr, powiadomienia, kanał systemowy, AFK, zaproszenia, vanity; kanały i role (CRUD, kolejność, ikony, uprawnienia), edytor nadpisań, emoji i naklejki, wydarzenia, webhooki, szablony serwera |
| Społeczność Discorda | `/community …` | włączanie Community (regulamin, kanał komunikatów), ekran powitalny, wdrażanie (pytania z menu ról, domyślne kanały), tagi forów i auto-tagowanie, automatyczna publikacja ogłoszeń, sceny, lista wymagań Odkrywania |
| Kreator serwera | `/builder templates·start·repair·preview·status·cancel·resume` | buduje kompletny serwer z szablonu (role, kategorie, kanały, uprawnienia, treści, panele, powiązania modułów) |
| Kopie zapasowe | `/backup create·list·load·export·import·delete` | kopia ról, kanałów, uprawnień i ustawień; przywracanie z podglądem |
| Konfiguracja | `/config show·set·reset·module·language·export·import·panel`, `/help` | wszystkie ustawienia z poziomu Discorda, pomoc z kategoriami i stronami |

Wszystkie operacje niszczące (usuwanie kanałów, ról, emoji, przywracanie kopii z usuwaniem…) wymagają
potwierdzenia przyciskiem i trafiają do logów moderacji oraz zdarzeń panelu.

## 1. Aplikacja Discord

1. Wejdź na <https://discord.com/developers/applications> → **New Application** (np. „Nore Bot”).
2. **Bot** → **Reset Token** → skopiuj token do `.env` (`DISCORD_TOKEN`). Nikomu go nie pokazuj.
3. Na tej samej stronie włącz **Privileged Gateway Intents**:
   * **Server Members Intent** – powitania, autorole, logi członków, weryfikacja, poziomy,
   * **Message Content Intent** – AutoMod, własne komendy, logi wiadomości, XP, most czatu Minecraft.
   (Presence Intent nie jest potrzebny.)
4. **General Information** → skopiuj **Application ID** do `.env` (`DISCORD_CLIENT_ID`).

Intencje, których używa bot: `Guilds, GuildMembers*, GuildMessages, MessageContent*, GuildMessageReactions,
GuildVoiceStates, GuildModeration, GuildExpressions, GuildScheduledEvents, GuildInvites, GuildWebhooks,
AutoModerationConfiguration` (* uprzywilejowane).

## 2. Zaproszenie bota

Podmień `CLIENT_ID` i otwórz link:

* **Pełny** (zalecany, potrzebny kreatorowi serwera, kopiom i konfiguratorowi):
  `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=8`
* **Bez Administratora** (wszystko poza kreatorem na pustym serwerze działa, jeśli rola bota jest wysoko):
  `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=1505274359031`
  (Zarządzanie serwerem, rolami, kanałami, wiadomościami, webhookami, wydarzeniami, wyrażeniami,
  pseudonimami i wątkami, wyrzucanie, banowanie, wyciszanie, dziennik zdarzeń, wysyłanie i osadzanie,
  pliki, reakcje, historia, wzmianki, łączenie, wyciszanie i przenoszenie na głosowych, zaproszenia).

Po dodaniu przesuń rolę bota **jak najwyżej** (Ustawienia serwera → Role) – bot może nadawać tylko role
niższe od swojej.

## 3. Instalacja i uruchomienie

```bash
cd discord-bot
cp .env.example .env        # uzupełnij DISCORD_TOKEN, DISCORD_CLIENT_ID (i NORE_BOT_SECRET)
npm install
npm run deploy-commands     # rejestracja komend (raz i po każdej zmianie komend)
node .                      # albo: npm start
```

`.env` (wszystkie klucze opisane w `.env.example`):

| Zmienna | Wymagana | Opis |
|---|---|---|
| `DISCORD_TOKEN` | tak | token bota |
| `DISCORD_CLIENT_ID` | tak | Application ID |
| `NORE_API` | nie | domyślnie `https://noreclient.pl` |
| `NORE_BOT_SECRET` | dla panelu | wspólny sekret z Workerem (API v2, nagłówek `Authorization: Bot …`); pusty = tryb offline |
| `DEPLOY_GUILD_ID` | nie | rejestracja komend tylko na jednym serwerze (natychmiast, do testów); pusty = globalnie |
| `BOT_SHARDS` | nie | `auto` (domyślnie) albo liczba shardów |
| `DATA_DIR` | nie | katalog danych (domyślnie `./data`) |
| `LOG_LEVEL`, `LOG_FORMAT` | nie | `debug/info/warn/error`, `pretty/json` |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | nie | feedy Twitcha (bez nich wyłączone) |
| `RSS_BRIDGE_URL` | nie | instancja RSS-Bridge dla TikToka/Instagrama/X |
| `MC_BRIDGE_PORT`, `MC_BRIDGE_HOST` | nie | API dla pluginu serwera Minecraft |

Pliki `.env` i `data/` są w `.gitignore` – **repozytorium jest publiczne, nigdy nie commituj tokenu**.

### Rejestracja komend

* `npm run deploy-commands` – globalnie (pojawiają się do godziny),
* `DEPLOY_GUILD_ID=123… npm run deploy-commands` albo `npm run deploy-commands -- --guild 123…` – od razu na jednym serwerze,
* `npm run deploy-commands -- --clear` – usuwa komendy.

Nazwy komend są angielskie (opisy, opcje i wybory są przetłumaczone na polski), `/help` ma też polską nazwę `/pomoc`.

### Sprawdzenie bez tokenu

```bash
npm run dry-run    # node . --dry-run: ładuje wszystkie moduły, buduje wszystkie komendy z tłumaczeniami,
                   # sprawdza limity Discorda, schemat, komplet tłumaczeń i każdy szablon kreatora
npm test           # testy jednostkowe (node --test)
npm run check      # node --check dla wszystkich plików
npm run schema     # odtwarza config.schema.json ze src/config/schema-source.js
```

## 4. Konfiguracja

Konfiguracja każdego serwera = **wartości domyślne** ze schematu ⊕ **konfiguracja z panelu**
(`https://noreclient.pl/panel`, API v2) ⊕ **lokalne zmiany** z `/config`.

* Bot pobiera konfigurację przez `GET /api/v2/bot/guilds/:id/config`, co 15 s pyta `GET /bot/changes`,
  co 10 minut (i po zmianach kanałów/ról) wysyła listę kanałów i ról do panelu (`PUT …/meta`).
* Kopia konfiguracji jest zapisywana na dysku – **bot działa w pełni bez API** (zapisuje w logu jeden
  komunikat i ponawia z rosnącym odstępem, maks. 5 min).
* `/config set klucz wartość` działa zawsze; zmiany są zgłaszane panelowi jako zdarzenie
  `config_local_change`. Zapis w panelu, który jest nowszy od lokalnej zmiany, ma pierwszeństwo.
* `config.schema.json` (JSON Schema 2020-12) opisuje każde ustawienie: typ, domyślną wartość, `x-ui`
  (rodzaj pola) i `x-i18n` (klucz etykiety `panel.*` w plikach językowych). Panel buduje formularze tylko
  z niego. Po zmianie schematu: `npm run schema`.
* Panel może zlecić botowi zadania przez `actions.queue` (budowa z szablonu, naprawa, kopia, panele,
  sprawdzenie Odkrywania, ustawienia serwera) – wynik wraca jako zdarzenie `action_result`.

## 5. Kreator serwera (`/builder`)

`/builder start template:… language:… size:…` → podgląd zmian (diff) → **Zbuduj serwer** →
automatyczna kopia zapasowa → budowa krok po kroku z paskiem postępu i szacowanym czasem → podsumowanie
z linkami. Budowa jest zapisywana po każdym kroku – po restarcie bota wznawia się sama
(`/builder resume` wznawia zatrzymaną). Ponowne uruchomienie niczego nie dubluje; `/builder repair`
odtwarza brakujące elementy i poprawia tematy, tryb powolny i uprawnienia istniejących.

| Szablon | Mały | Średni | Pełny |
|---|---|---|---|
| `mc-server` – serwer Minecraft **MC.noreclient.pl** | 30 ról, 49 kanałów | 50 ról, 118 kanałów | 64 role, 210 kanałów |
| `nore-client` – społeczność Nore Client | 34 role, 57 kanałów | 45 ról, 115 kanałów | 50 ról, 158 kanałów |
| `gaming` – społeczność graczy | 24 role, 22 kanały | 34 role, 77 kanałów | 34 role, 92 kanały |
| `support` – tylko pomoc | 8 ról, 15 kanałów | 9 ról, 25 kanałów | 9 ról, 28 kanałów |

(Liczby kanałów razem z kategoriami; dokładne wartości pokazują `/builder templates` i `npm run dry-run`.)

Szablony zawierają m.in. hierarchię ekipy (Właściciel, Zarząd, Administrator, Developer, Moderator,
Pomocnik, Okres próbny…), role wyróżnień (Partner, Twórca, YouTuber, Streamer, Beta tester, Booster,
VIP…), rangi z gry synchronizowane pluginem, role za poziomy, role pingów, języków i trybów gry,
separatory, kolory i ikony ról (od 2. poziomu boostów); sekcję ekipy widoczną tylko dla ekipy (czaty,
logi, podania, zgłoszenia, lista zadań, głosowe); współprace z formularzem i kanałem reklam partnerów;
tickety, propozycje (forum z tagami statusów), weryfikację, tablicę statusu, status serwera na żywo;
gotowe wiadomości (regulamin, zacznij tutaj, FAQ, jak dołączyć, linki, opis ról, program partnerski,
rekrutacja, program twórców, beta, boosty, poradnik ekipy…) i ustawienia (weryfikacja, filtr, Community,
automatyczna publikacja). Każdy moduł bota jest od razu podpięty do utworzonych kanałów i ról.

### Szablony kreatora

Pliki `templates/<id>.json`, teksty w `locales/templates/<lang>.json`:

* `roles`: `{ key, color, hoist, perms (nazwa zestawu z permissionSets albo lista), icon, size, separator, menu, level, each, bind }`
* `categories`: `{ key, emoji, access, size, each, bindCategory, channels: [{ key, type, emoji, mode, access, slowmode, userLimit, size, content, panel, bind, each, tags }] }`
  * `access`: `everyone`, `unverified`, `member`, `staff`, `admin`, `role:a,b`
  * `mode`: `readonly`, `media`, `nolinks`
  * `size`: `small`/`medium`/`full` – najmniejszy rozmiar, w którym element występuje
  * `each`: lista z `lists` (generuje role, kategorie lub kanały, np. tryby gry, poziomy, kanały głosowe)
  * `content`: treści do wysłania (`rules`, `start`, `faq`, `howtojoin`, `partners`, …), `panel`: `verification`, `tickets`, `suggestions`, `selfroles`, `apply:<form>`, `statusboard`
  * `bind`: ścieżki konfiguracji ustawiane na id kanału/roli (`welcome.channel`, `applications.forms[partner].role`, `autorole.botRoles+` dopisuje do listy)
* `groups`: które role tworzą ekipę, administrację, moderację, członków i wyciszonych
* `binds`, `enable`, `settings`: dodatkowe ustawienia modułów i serwera

Testy (`npm test`) sprawdzają każdy szablon w każdym języku i rozmiarze pod kątem limitów Discorda
(250 ról, 500 kanałów, 50 kanałów w kategorii, długości nazw), tłumaczeń, uprawnień i idempotencji.

## 6. Dane

`data/guilds/<id>.json` – jeden plik na serwer (konfiguracja z panelu i lokalne zmiany, sprawy
moderacyjne, XP, tickety, propozycje, konkursy, timery, stan feedów, kopie zapasowe, stan kreatora),
zapisywany atomowo w tle. Kopię zapasową bota robi się, kopiując katalog `data/`.

## 7. Sharding

`BOT_SHARDS=auto` pyta Discorda o zalecaną liczbę shardów: przy 1 bot działa w jednym procesie, przy
większej liczbie `node .` uruchamia `ShardingManager` (proces na shard, automatyczny restart).
Dane są per serwer, więc shardy się nie kłócą.

## 8. Praca ciągła (opcjonalnie)

**pm2**

```bash
npm i -g pm2
pm2 start index.js --name nore-bot --cwd /opt/nore/discord-bot
pm2 save && pm2 startup
pm2 logs nore-bot
```

**systemd** (`/etc/systemd/system/nore-bot.service`)

```ini
[Unit]
Description=Nore Bot
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/nore/discord-bot
ExecStart=/usr/bin/node .
Restart=always
RestartSec=5
User=nore
Environment=LOG_FORMAT=json

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now nore-bot
journalctl -u nore-bot -f
```

Bot kończy pracę łagodnie na `SIGINT`/`SIGTERM` (zapisuje dane, zamyka połączenie).

## 9. Problemy

* **Komendy się nie pojawiają** – `npm run deploy-commands` (globalne potrzebują do godziny; do testów `DEPLOY_GUILD_ID`).
* **„Brakuje mi uprawnień”** – nadaj je roli bota albo przesuń ją wyżej.
* **Bot nie widzi treści wiadomości** – włącz Message Content Intent w Developer Portal.
* **Brak grafik powitalnych** – opcjonalny pakiet `@napi-rs/canvas` (gotowe binaria, bez kompilacji) nie
  zainstalował się albo system nie ma czcionek; bot wysyła wtedy zwykły embed.
* **API niedostępne** – w logu pojawi się jeden komunikat; bot działa dalej na zapisanej konfiguracji.
