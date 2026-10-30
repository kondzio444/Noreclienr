package dev.noreclient.gui.menu;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.click.ClickGuiScreen;
import dev.noreclient.gui.click.RadialMenuScreen;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.widget.Album;
import dev.noreclient.gui.widget.SideNav;
import dev.noreclient.gui.widget.TextBox;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.Events;
import dev.noreclient.util.Friends;
import dev.noreclient.util.Heads;
import dev.noreclient.util.LauncherChat;
import dev.noreclient.util.MenuBackground;
import dev.noreclient.util.Motion;
import dev.noreclient.util.NoreHub;
import dev.noreclient.util.OfficialServer;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.ServerInfo;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;
import dev.noreclient.util.ThemeTokens;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Title screen in the "Album" direction (design/mocks/game-main-menu.html): an album sheet on the
 * left with a cover spine, the logo sticker and menu rows that turn into white stickers with a peel
 * corner; on the right the clock on a dark label, shortcut slots, a taped "Nowe w" clipping (the
 * event poster during Halloween), quick join with the official Nore MC server and friends' heads.
 * During Halloween the lights are out: night panorama, a torch around the cursor, glowing pumpkins.
 */
public class NoreMainMenu extends NoreScreen {
    private static final String[][] NEWS = {
            {"Album: nowy wygląd menu", "A"},
            {"Oficjalny serwer Nore MC", "N"},
            {"Halloween: zgaszone światło", "E"},
            {"Szatnia: uszy, peleryny, aureole", "I"},
            {"Radialne menu pod Prawym Shiftem", "R"},
    };

    /** Shortcut slots under the clock. */
    private static final int[] TILE_ICONS = {SideNav.CAMERA, SideNav.PERSON, SideNav.STAR, SideNav.MODS, SideNav.SHOP, SideNav.HELP};
    private static final String[] TILE_LABELS = {"Zrzuty ekranu", "Znajomi", "Kosmetyki", "Mody", "Sklep – wkrótce", "Poradnik"};
    private final Animation[] tileHover = new Animation[TILE_ICONS.length];
    private float tilesX, tilesY;
    private static final float TILE = 18, TILE_GAP = 4;

    /** Only the first menu of a session plays the event reveal. */
    private static boolean firstOpen = true;

    private final long opened = System.currentTimeMillis();
    private final boolean reveal;
    private final SideNav nav = new SideNav();
    private final Animation[] hover = new Animation[16];
    private List<String[]> servers = new ArrayList<String[]>();
    private Runnable pending;
    private long leaving;

    // layout of the last frame (for clicks)
    private float sheetX, sheetW, navX, navY, navW, rowH, colX, colW, serversY, joinY = -1000, friendsY = -1000, accY;
    private float torchX = -1, torchY = -1;

    public NoreMainMenu() {
        super(null);
        for (int i = 0; i < hover.length; i++) hover[i] = new Animation(0, 16);
        for (int i = 0; i < tileHover.length; i++) tileHover[i] = new Animation(0, 16);
        reveal = firstOpen;
        firstOpen = false;
    }

    @Override
    protected void init() {
        nav.clear();
        final NoreMainMenu self = this;
        nav.add("Singleplayer", "Twoje światy", SideNav.PLAY, SideNav.NORMAL, () -> go(() -> game().openSingleplayer(self)))
                .add("Multiplayer", "Serwery", SideNav.GLOBE, SideNav.NORMAL, () -> go(() -> game().openMultiplayer(self)))
                .add("Zagraj na " + OfficialServer.NAME, "oficjalny", SideNav.STAR, SideNav.NORMAL, this::joinOfficial)
                .add("Moduły klienta", null, SideNav.GRID, SideNav.NORMAL, () -> go(() -> game().openScreen(new RadialMenuScreen(self)))).key("P.Shift")
                .add("Szatnia", "peleryny, uszy", SideNav.PERSON, SideNav.NORMAL, () -> go(() -> game().openScreen(new CosmeticsScreen(self))))
                .add("Edytor HUD", "Nakładki", SideNav.HUD, SideNav.NORMAL, () -> go(() -> game().openScreen(new HudEditorScreen(self))))
                .add("Pobieraj zasoby", "Modrinth", SideNav.DOWNLOAD, SideNav.NORMAL, () -> go(() -> game().openScreen(ClickGuiScreen.forDownloads(self))))
                .add("Opcje", "Ustawienia gry", SideNav.GEAR, SideNav.NORMAL, () -> go(() -> game().openOptions(self)))
                .add("Wyjdź z gry", null, SideNav.POWER, SideNav.DANGER, () -> go(() -> game().quit()));
        try {
            servers = game().serverList();
        } catch (Exception e) {
            servers = new ArrayList<String[]>();
        }
        // the official server has its own entry (row + featured sticker)
        List<String[]> own = new ArrayList<String[]>();
        for (String[] s : servers) if (!OfficialServer.matches(s[1])) own.add(s);
        servers = own;
    }

    /** Joins Nore MC through its saved entry (keeps the resource pack choice stored with it). */
    private void joinOfficial() {
        final NoreMainMenu self = this;
        String[] entry = new String[]{OfficialServer.NAME, OfficialServer.ADDRESS};
        try {
            List<String[]> all = game().serverList();
            int i = OfficialServer.indexIn(all);
            if (i >= 0) entry = all.get(i);
        } catch (Exception ignored) { }
        final String[] e = entry;
        go(() -> game().connect(e[0], e[1], self));
    }

    @Override
    public Background background() { return Background.NONE; }

    /** Entrance of the i-th element (stagger 45 ms, max 8). */
    private float in(int i) { return Motion.enter(opened, i); }

    @Override
    public void render(Gfx ctx, int mouseX, int mouseY, float delta) {
        CurrentGfx.set(ctx);
        boolean halloween = Events.halloween();
        boolean winter = Events.winter();
        float intensity = Events.intensity();

        // ---- world behind the album
        if (halloween) {
            if (!MenuBackground.renderNight(ctx, width, height, mouseX, mouseY)) MenuBackground.render(ctx, width, height, mouseX, mouseY);
        } else {
            MenuBackground.render(ctx, width, height, mouseX, mouseY);
        }
        float bgIn = Motion.progress(opened, 0, 600, ThemeTokens.EASE_OUT);
        if (bgIn < 1) Render2D.rect(ctx, 0, 0, width, height, ColorUtil.withAlpha(0xFF000000, (int) (255 * (1 - bgIn))));
        // the album side is a little darker so the sheet reads over a bright panorama
        Render2D.quadGradient(ctx, 0, 0, width * 0.45f, height, 0x8C0A090C, 0x000A090C, 0x000A090C, 0x8C0A090C);

        sheetW = Math.max(150, Math.min(178, width * 0.33f));
        sheetX = 10;
        colW = Math.min(196, width - sheetW - 40);
        colX = width - 13 - colW;

        if (halloween) lightsOut(ctx, mouseX, mouseY, intensity);
        if (winter) {
            ctx.setAlpha(Motion.progress(opened, 400, 1400, ThemeTokens.EASE_OUT));
            ChristmasDecor.frost(ctx, width, height, intensity);
            if (Motion.ambient()) ChristmasDecor.snow(ctx, width, height, intensity);
            ctx.setAlpha(1);
        }

        // ---- leaving: the page drops 14 px left and fades (dur.exit, ease.in)
        float out = 0;
        if (pending != null) {
            out = Motion.progress(leaving, 0, ThemeTokens.DUR_EXIT, ThemeTokens.EASE_IN);
            if (out >= 1) {
                Runnable r = pending;
                pending = null;
                // switch screens after this frame: the next screen may render a frame of its own right away
                NoreClient.runNextTick(r);
            }
        }
        ctx.setAlpha(1 - out);
        ctx.push();
        ctx.translate(-14 * out * Motion.travel(), 0);

        renderSheet(ctx, mouseX, mouseY, halloween, winter);
        renderColumn(ctx, mouseX, mouseY, halloween);

        ctx.pop();
        ctx.setAlpha(1);

        // credit line
        String scene = MenuBackground.sceneLabel(halloween);
        String foot = scene == null ? NoreClient.NAME + " " + NoreClient.VERSION : scene;
        Render2D.text(ctx, foot, width - 13 - Render2D.textWidth(foot), height - 9 - 8, ColorUtil.withAlpha(Theme.TEXT, 140), true);

        // welcome guide (first start)
        if (guideStep < 0 && !guideChecked && System.currentTimeMillis() - opened > 1100) {
            guideChecked = true;
            if (settings().welcomeGuide.isOn()) guideStep = 0;
        }
        if (guideStep >= 0) renderGuide(ctx, mouseX, mouseY);
        dev.noreclient.cosmetic.SecretEars.menu(ctx, width, height, mouseX, mouseY);
    }

    // ------------------------------------------------------------------ halloween: lights out

    private void lightsOut(Gfx ctx, int mouseX, int mouseY, float intensity) {
        long t = System.currentTimeMillis() - opened;
        // torch follows the pointer (lerp 0.18 per frame)
        if (torchX < 0) { torchX = mouseX; torchY = mouseY; }
        float follow = Motion.level() == Motion.FULL ? 0.18f : 1f;
        torchX += (mouseX - torchX) * follow;
        torchY += (mouseY - torchY) * follow;

        // reveal: the bulb fails in two flickers, then the torch fades in (compressed to 900 ms)
        float dark = 0.62f * intensity + 0.1f;
        float torchIn = 1;
        if (reveal && Motion.level() == Motion.FULL && t < 900) {
            if (t < 90) dark *= 0.55f;
            else if (t < 160) dark *= 0.1f;
            else if (t < 260) dark *= 0.8f;
            torchIn = Math.max(0, (t - 520) / 380f);
        } else if (Motion.level() != Motion.FULL) {
            torchIn = Motion.progress(opened, 0, 200, ThemeTokens.EASE_OUT);
        }
        int night = ColorUtil.withAlpha(0xFF050406, (int) (255 * dark));
        float r = Math.max(70, Math.min(width, height) * 0.34f);
        int warm = ColorUtil.withAlpha(ThemeTokens.HALLOWEEN_TORCH, (int) (ColorUtil.alpha(ThemeTokens.HALLOWEEN_TORCH) * torchIn));
        int mid = ColorUtil.lerp(night, warm, torchIn);
        // darkness everywhere outside the cone, a warm soft cone around the cursor
        float far = (float) Math.sqrt(width * (double) width + height * (double) height) * 2;
        darkness(ctx, torchX, torchY, r, far, night);
        Render2D.radial(ctx, torchX, torchY, r, ColorUtil.lerp(night, warm, torchIn), night);
        if (torchIn < 1) Render2D.radial(ctx, torchX, torchY, r, ColorUtil.withAlpha(night, (int) (ColorUtil.alpha(night) * (1 - torchIn))), 0);
        Render2D.radial(ctx, torchX, torchY, r * 0.55f, ColorUtil.withAlpha(mid, (int) (40 * torchIn)), 0);

        // bats over the empty middle, glowing pumpkins on the ground
        float midX0 = sheetX + sheetW + 6, midX1 = colX - 6;
        float glowIn = reveal ? Motion.progress(opened, 700, 500, ThemeTokens.EASE_OUT) : 1;
        if (Motion.ambient()) {
            ctx.setAlpha(glowIn * (0.5f + 0.5f * intensity));
            HalloweenDecor.bats(ctx, midX0, 40, Math.max(midX0 + 50, midX1), Math.max(120, height * 0.6f));
            ctx.setAlpha(1);
        }
        if (midX1 - midX0 > 70) {
            ctx.setAlpha(glowIn);
            float base = height - 34;
            pumpkin(ctx, midX0 + (midX1 - midX0) * 0.38f, base - 24, 26, 0);
            pumpkin(ctx, midX0 + (midX1 - midX0) * 0.58f, base - 14, 18, 1.7f);
            ctx.setAlpha(1);
        }
    }

    /** Fills everything outside the circle (cx, cy, r) with {@code color}; same 48 segments as {@link Render2D#radial}. */
    private static void darkness(Gfx ctx, float cx, float cy, float r, float far, int color) {
        int seg = 48;
        float[] xy = new float[(seg + 1) * 4];
        int[] col = new int[(seg + 1) * 2];
        for (int i = 0; i <= seg; i++) {
            double a = Math.PI * 2 * i / seg;
            float c = (float) Math.cos(a), s = (float) Math.sin(a);
            xy[i * 4] = cx + c * r; xy[i * 4 + 1] = cy + s * r;
            xy[i * 4 + 2] = cx + c * far; xy[i * 4 + 3] = cy + s * far;
            col[i * 2] = color; col[i * 2 + 1] = color;
        }
        ctx.mesh(Gfx.TRIANGLE_STRIP, xy, col, (seg + 1) * 2);
    }

    /** Pumpkin sticker with a candle-flickering orange glow. */
    private void pumpkin(Gfx ctx, float x, float y, float h, float phase) {
        double s = System.currentTimeMillis() / 1000.0 + phase;
        float fl = Motion.ambient() ? (float) (0.75 + 0.12 * Math.sin(s * 7.3) + 0.08 * Math.sin(s * 13.1 + 1) + 0.05 * Math.sin(s * 23.7)) : 0.85f;
        Render2D.radial(ctx, x + h / 2f, y + h * 0.55f, h * 1.3f, ColorUtil.withAlpha(ThemeTokens.HALLOWEEN_PUMPKIN, (int) (90 * fl)), 0x00FF7417);
        if (Album.sprite(ctx, "pumpkin_sticker", x, y, h, 1f) == 0) HalloweenDecor.pumpkin(ctx, x, y, h / 11f);
    }

    // ------------------------------------------------------------------ left: the album sheet

    private void renderSheet(Gfx ctx, int mouseX, int mouseY, boolean halloween, boolean winter) {
        float sp = Motion.screen(opened);
        float slide = (1 - sp) * -6 * Motion.travel();
        float sy = 10, sh = height - 20;
        ctx.push();
        ctx.translate(slide, 0);
        float base = ctx.getAlpha();
        ctx.setAlpha(base * sp);
        Album.sheet(ctx, sheetX, sy, sheetW, sh);
        Album.spine(ctx, sheetX, sy, sh);
        if (winter) ChristmasDecor.lights(ctx, sheetX + 10, sheetX + sheetW - 8, sy + 3);

        // brand: logo sticker + NORE 2x + version (or the event line)
        float bx = sheetX + 16, by = sy + 13;
        Album.logo(ctx, bx, by, 30, base * sp);
        if (halloween) {
            Album.phosphor(ctx, bx + 27, by + 25, 11, Events.intensity());
            Album.sprite(ctx, "ghost_sticker", bx + 20, by + 17, 14, 1f);
        }
        Album.title(ctx, "NORE", bx + 37, by + 4, Theme.TEXT);
        if (halloween) Album.text(ctx, "Halloween 2026", bx + 37, by + 22, ThemeTokens.HALLOWEEN_PUMPKIN);
        else if (winter) Album.text(ctx, "Seria zimowa", bx + 37, by + 22, ThemeTokens.WINTER_ICE);
        else Album.text(ctx, "Client " + NoreClient.VERSION, bx + 37, by + 22, Theme.TEXT_DIM);

        // navigation rows
        float top = sy + 52, bottom = sy + sh - 40;
        rowH = Math.max(14, Math.min(21, (bottom - top - 8) / (float) nav.size()));
        navX = sheetX + 12;
        navW = sheetW - 22;
        navY = top;
        float[] stages = new float[nav.size()];
        for (int i = 0; i < stages.length; i++) stages[i] = in(i + 1);
        nav.render(ctx, navX, navY, navW, rowH, (int) (mouseX - slide), mouseY, pending == null && guideStep < 0, stages);

        // account card
        accY = sy + sh - 32;
        ctx.setAlpha(base * in(10));
        float ax = sheetX + 12, aw = sheetW - 22;
        Album.raised(ctx, ax, accY, aw, 26);
        Album.head(ctx, Heads.get(game().username()), ax + 5, accY + 5, 16, 0);
        Render2D.text(ctx, Render2D.trim(game().username(), (int) aw - 34), ax + 27, accY + 4, Theme.TEXT, false);
        boolean hub = LauncherChat.connected();
        Album.dot(ctx, ax + 29, accY + 18, 2, hub ? ThemeTokens.DOT_READY : ThemeTokens.DOT_OFF);
        Render2D.text(ctx, Render2D.trim((hub ? "online" : "offline") + " · " + game().minecraftVersion(), (int) aw - 40), ax + 34, accY + 14, Theme.TEXT_MUTED, false);
        ctx.setAlpha(base);
        ctx.pop();
    }

    // ------------------------------------------------------------------ right column

    private void renderColumn(Gfx ctx, int mouseX, int mouseY, boolean halloween) {
        float base = ctx.getAlpha();
        float rx = width - 13;
        boolean interactive = pending == null && guideStep < 0;

        // clock on a dark label
        Date now = new Date();
        String clock = new SimpleDateFormat("HH:mm", Locale.ROOT).format(now);
        String date = new SimpleDateFormat("EEEE, d MMMM", new Locale("pl", "PL")).format(now);
        float cw = Math.max(Render2D.textWidth(clock) * 3, Render2D.textWidth(date)) + 18;
        float cp = in(2);
        ctx.setAlpha(base * cp);
        float cy = 10 - (1 - cp) * 4 * Motion.travel();
        Render2D.roundedRect(ctx, rx - cw, cy, cw, 46, Album.R, ColorUtil.withAlpha(Theme.page(), 0xD8));
        Render2D.scaledText(ctx, clock, rx - 8 - Render2D.textWidth(clock) * 3, cy + 7, 3, Theme.TEXT, false);
        Album.right(ctx, date, rx - 8, cy + 34, Theme.TEXT_DIM);

        // shortcut slots, left of the clock when there is room, otherwise under it
        float tilesW = TILE_ICONS.length * (TILE + TILE_GAP) - TILE_GAP;
        if (rx - cw - 8 - tilesW > sheetX + sheetW + 10) {
            tilesX = rx - cw - 8 - tilesW;
            tilesY = 10;
        } else {
            tilesX = rx - tilesW;
            tilesY = cy + 50;
        }
        for (int i = 0; i < TILE_ICONS.length; i++) {
            float tx = tilesX + i * (TILE + TILE_GAP);
            float tp = in(3 + i);
            boolean th = interactive && Render2D.hovered(mouseX, mouseY, tx, tilesY, TILE, TILE);
            float h = tileHover[i].target(th ? 1 : 0).update();
            ctx.setAlpha(base * tp);
            if (h > 0.02f) Album.white(ctx, tx, tilesY, TILE, TILE, h);
            else Render2D.roundedRect(ctx, tx, tilesY, TILE, TILE, Album.R, ColorUtil.withAlpha(Theme.page(), 0xD8));
            float ly = tilesY - h * Motion.travel();
            SideNav.icon(ctx, TILE_ICONS[i], tx + TILE / 2f, ly + TILE / 2f, 9, ColorUtil.lerp(Theme.TEXT_DIM, Theme.accent(), Math.min(1, h * 1.5f)));
            if (i == 4) Album.dot(ctx, tx + TILE - 2, tilesY + 2, 1.6f, ThemeTokens.DOT_WAIT);
            if (h > 0.05f) {
                String l = TILE_LABELS[i];
                float lw = Render2D.textWidth(l) + 10, lx = Math.max(4, Math.min(rx - lw, tx + TILE / 2f - lw / 2f));
                ctx.setAlpha(base * h);
                Album.floating(ctx, lx, tilesY + TILE + 4, lw, 13, ColorUtil.withAlpha(Theme.SLOT, 0xF2));
                Render2D.text(ctx, l, lx + 5, tilesY + TILE + 6.5f, Theme.TEXT, false);
            }
        }
        float y = Math.max(cy + 46, tilesY + TILE) + 12;

        if (colW < 140) { joinY = -1000; friendsY = -1000; ipY = -1000; ctx.setAlpha(base); return; }

        // clipping: what's new, or the event poster
        float clipP = in(9);
        ctx.setAlpha(base * clipP);
        float cyy = y + (1 - clipP) * 6 * Motion.travel();
        if (halloween) {
            float ph = 92;
            if (cyy + ph < height - 70) {
                poster(ctx, colX, cyy, colW, ph);
                y += ph + 10;
            }
        } else {
            float nh = 20 + NEWS.length * 11 + 4;
            if (cyy + nh < height - 70) {
                Album.clipping(ctx, colX, cyy, colW, nh, Events.tape(), colW / 2f - 15);
                Render2D.text(ctx, "Nowe w " + NoreClient.VERSION, colX + 10, cyy + 9, Theme.VINYL_INK, false);
                for (int i = 0; i < NEWS.length; i++) {
                    float ly = cyy + 22 + i * 11;
                    Album.dot(ctx, colX + 12, ly + 3.5f, 2, newsColor(NEWS[i][1]));
                    Render2D.text(ctx, Render2D.trim(NEWS[i][0], (int) colW - 28), colX + 19, ly, 0xFF4B444E, false);
                }
                y += nh + 10;
            }
        }

        // quick join
        ctx.setAlpha(base * in(10));
        y = quickJoin(ctx, y, mouseX, mouseY, interactive);

        // friends
        ctx.setAlpha(base * in(11));
        friendsY = -1000;
        if (y + 26 < height - 22) friends(ctx, y, mouseX, mouseY);
        ctx.setAlpha(base);
    }

    private static int newsColor(String k) {
        switch (k) {
            case "A": return Theme.accent();
            case "E": return ThemeTokens.DOT_EVENT;
            case "N": return ThemeTokens.DOT_READY;
            default: return ThemeTokens.DOT_INFO;
        }
    }

    /** Halloween poster taped with kraft tape: title, two lines, the three capes and the countdown. */
    private void poster(Gfx ctx, float x, float y, float w, float h) {
        Render2D.shadow(ctx, x, y + 1, w, h, Album.R, 4, 0x80000000);
        Render2D.roundedRect(ctx, x, y, w, h, Album.R, 0xFF5A2A10);
        Render2D.roundedRect(ctx, x + 1, y + 1, w - 2, h - 2, Album.R - 1, 0xF21A1210);
        Album.tape(ctx, x + 10, y - 4, 30, 8, ThemeTokens.TAPE_KRAFT);
        Album.title(ctx, "Halloween", x + 10, y + 9, ThemeTokens.HALLOWEEN_PUMPKIN);
        Render2D.text(ctx, Render2D.trim("Zgaszone światło do 3 listopada.", (int) w - 20), x + 10, y + 29, Theme.TEXT_DIM, false);
        Render2D.text(ctx, "Zbierz trzy peleryny.", x + 10, y + 39, Theme.TEXT_DIM, false);
        String[] capes = {"cape_dynia", "cape_nietoperz", "cape_pajeczyna"};
        float cx = x + 10, capY = y + 53;
        for (String c : capes) {
            Render2D.roundedRect(ctx, cx - 1, capY - 1, 21, 30, 3, Theme.VINYL);
            Render2D.roundedRect(ctx, cx, capY, 19, 28, 2, 0xFF151317);
            Album.sprite(ctx, c, cx + 1, capY + 1, 26, 1f);
            cx += 25;
        }
        String left = Events.halloweenLeft();
        float tx = x + w - 10 - Render2D.textWidth(left) * 2;
        Render2D.scaledText(ctx, left, tx, capY + 3, 2, ThemeTokens.HALLOWEEN_PHOSPHOR, false);
        Album.right(ctx, "do końca", x + w - 10, capY + 21, Theme.TEXT_DIM);
    }

    // ------------------------------------------------------------------ quick join

    private final TextBox ipBox = new TextBox("Wpisz IP serwera...", 64);
    private float ipX, ipY = -1000, ipW, joinX, previewY = -1000, previewH, officialJoinX;
    private int savedShown;

    private String typedAddress() {
        String t = ipBox.getText().trim();
        return ServerInfo.looksLikeAddress(t) ? t : null;
    }

    private float quickJoin(Gfx ctx, float y, int mouseX, int mouseY, boolean interactive) {
        // featured: Nore MC as a sticker card with live players and the Dołącz pill
        joinY = -1000;
        ipY = -1000;
        serversY = -1000;
        previewY = -1000;
        if (y + 36 > height - 20) return y;
        joinY = y;
        float h = 36;
        Album.sheet(ctx, colX, y, colW, h);
        Render2D.roundedRect(ctx, colX - 1 + 7, y + 6, 24, 24, 3, Theme.VINYL);
        Render2D.roundedRect(ctx, colX + 7, y + 7, 22, 22, 3, Theme.accentDeep());
        ServerInfo.Info off = ServerInfo.get(OfficialServer.ADDRESS);
        if (off != null && off.favicon != null) Render2D.texture(ctx, off.favicon, colX + 7, y + 7, 22, 22, 1f);
        else Album.logo(ctx, colX + 9, y + 9, 18, 1f);
        float tx = colX + 36;
        Render2D.text(ctx, OfficialServer.NAME, tx, y + 7, Theme.TEXT, false);
        int dot;
        String sub;
        if (off == null || off.state == ServerInfo.State.LOADING && off.online < 0) { dot = ThemeTokens.DOT_WAIT; sub = "sprawdzanie..."; }
        else if (off.state == ServerInfo.State.OFFLINE) { dot = ThemeTokens.DOT_ERROR; sub = "offline"; }
        else { dot = ThemeTokens.DOT_READY; sub = off.online + "/" + off.max + " · oficjalny"; }
        Album.dot(ctx, tx + 2, y + 22, 2, dot);
        float bw = Render2D.textWidth("Dołącz") + 14;
        officialJoinX = colX + colW - 8 - bw;
        Render2D.text(ctx, Render2D.trim(sub, (int) (officialJoinX - tx - 12)), tx + 7, y + 18, Theme.TEXT_DIM, false);
        boolean jh = interactive && Render2D.hovered(mouseX, mouseY, officialJoinX, y + 11, bw, 14);
        Album.button(ctx, officialJoinX, y + 11, bw, 14, "Dołącz", Album.PRIMARY, hover[13].target(jh ? 1 : 0).update());
        y += h + 6;

        // address box + join
        if (y + 18 > height - 20) return y;
        String typed = typedAddress();
        String settled = ServerInfo.settled(ipBox, ipBox.getText());
        ServerInfo.Info preview = settled == null ? null : ServerInfo.get(settled);
        ipX = colX; ipY = y; ipW = colW - 46;
        ipBox.render(ctx, ipX, ipY, ipW, 16, TextBox.SEARCH_ICON);
        joinX = ipX + ipW + 4;
        boolean ah = interactive && Render2D.hovered(mouseX, mouseY, joinX, ipY, 42, 16);
        Album.button(ctx, joinX, ipY + 1, 42, 14, "Dołącz", Album.SECONDARY, hover[14].target(ah ? 1 : 0).update(), typed != null);
        y += 20;

        if (preview != null && y + 46 < height - 20) {
            previewY = y;
            previewH = 42;
            serverPreview(ctx, preview, colX, y, colW, previewH);
            y += previewH + 4;
        }

        // saved servers (up to 3 rows of 18)
        int maxSaved = (int) Math.max(0, Math.min(3, (height - 22 - 30 - y) / 20));
        savedShown = Math.min(maxSaved, servers.size());
        serversY = y;
        for (int i = 0; i < savedShown; i++) {
            String[] s = servers.get(i);
            float ry = serversY + i * 20;
            boolean hov = interactive && Render2D.hovered(mouseX, mouseY, colX, ry, colW, 18);
            float hv = hover[i].target(hov ? 1 : 0).update();
            if (hv > 0.02f) Album.white(ctx, colX, ry, colW, 18, hv);
            else Render2D.roundedRect(ctx, colX, ry, colW, 18, Album.R, ColorUtil.withAlpha(Theme.page(), 0xC8));
            float ly = ry - hv * Motion.travel();
            ServerInfo.Info info = ServerInfo.get(s[1]);
            if (info != null && info.favicon != null) Render2D.texture(ctx, info.favicon, colX + 3, ly + 3, 12, 12, 1f);
            else Album.slot(ctx, colX + 3, ly + 3, 12, 12, 2);
            int ink = ColorUtil.lerp(Theme.TEXT, Theme.VINYL_INK, Math.min(1, hv * 1.6f));
            Render2D.text(ctx, Render2D.trim(s[0], (int) colW - 70), colX + 19, ly + 5, ink, false);
            String st;
            int sd;
            if (info == null || info.state == ServerInfo.State.LOADING && info.online < 0) { st = "..."; sd = ThemeTokens.DOT_WAIT; }
            else if (info.state == ServerInfo.State.OFFLINE) { st = "offline"; sd = ThemeTokens.DOT_ERROR; }
            else { st = info.online + "/" + info.max; sd = ThemeTokens.DOT_READY; }
            float sw = Render2D.textWidth(st);
            Render2D.text(ctx, st, colX + colW - 6 - sw, ly + 5, ColorUtil.lerp(Theme.TEXT_DIM, Theme.VINYL_INK_SOFT, Math.min(1, hv * 1.6f)), false);
            Album.dot(ctx, colX + colW - 12 - sw, ly + 9, 2, sd);
        }
        if (savedShown > 0) y += savedShown * 20 + 2;
        return y + 4;
    }

    private void serverPreview(Gfx ctx, ServerInfo.Info info, float x, float y, float w, float h) {
        Album.raised(ctx, x, y, w, h);
        if (info.favicon != null) {
            Render2D.roundedRect(ctx, x + 4, y + 4, 26, 26, 2, Theme.VINYL);
            Render2D.texture(ctx, info.favicon, x + 5, y + 5, 24, 24, 1f);
        } else {
            Album.slot(ctx, x + 4, y + 4, 26, 26);
            if (info.state == ServerInfo.State.LOADING) {
                float a = (System.currentTimeMillis() % 900) / 900f * 360;
                Render2D.ring(ctx, x + 17, y + 17, 6, 1.6f, a, a + 260, Theme.accent());
            }
        }
        float tx = x + 35, tw = w - 39;
        if (info.state == ServerInfo.State.OFFLINE && info.online < 0) {
            Render2D.text(ctx, Render2D.trim(info.address, (int) tw), tx, y + 5, Theme.TEXT, false);
            Album.dot(ctx, tx + 2, y + 20, 2, ThemeTokens.DOT_ERROR);
            Render2D.text(ctx, Render2D.trim(info.error == null ? "Serwer nie odpowiada" : info.error, (int) tw - 8), tx + 7, y + 16, Theme.TEXT_DIM, false);
            return;
        }
        if (info.state == ServerInfo.State.LOADING && info.online < 0) {
            Render2D.text(ctx, Render2D.trim(info.address, (int) tw), tx, y + 5, Theme.TEXT, false);
            Album.dot(ctx, tx + 2, y + 20, 2, ThemeTokens.DOT_WAIT);
            Render2D.text(ctx, "Sprawdzanie serwera...", tx + 7, y + 16, Theme.TEXT_DIM, false);
            return;
        }
        ServerInfo.drawFlag(ctx, info, tx, y + 5.5f, 7);
        String players = info.online + " / " + info.max + " graczy";
        Render2D.text(ctx, players, tx + 13, y + 5, Theme.TEXT, false);
        Render2D.text(ctx, info.ping + " ms", x + w - 5 - Render2D.textWidth(info.ping + " ms"), y + 5, Theme.TEXT_MUTED, false);
        String[] motd = info.motd.split("\n");
        if (motd.length > 0) Render2D.text(ctx, Render2D.trim(motd[0].trim(), (int) tw), tx, y + 17, 0xFFDDDDDD, false);
        // player bar: exact length
        float pct = info.max > 0 ? Math.min(1, info.online / (float) info.max) : 0;
        Render2D.roundedRect(ctx, x + 4, y + 34, w - 8, 3, 1.5f, Theme.SLOT);
        Render2D.roundedRect(ctx, x + 4, y + 34, (w - 8) * pct, 3, 1.5f, Theme.accent());
    }

    // ------------------------------------------------------------------ friends

    private void friends(Gfx ctx, float y, int mouseX, int mouseY) {
        friendsY = y;
        boolean hov = pending == null && guideStep < 0 && Render2D.hovered(mouseX, mouseY, colX, y, colW, 22);
        float hv = hover[15].target(hov ? 1 : 0).update();
        Render2D.roundedRect(ctx, colX, y, colW, 22, Album.R, ColorUtil.withAlpha(ColorUtil.lerp(Theme.page(), Theme.raised(), hv), 0xD8));
        Render2D.text(ctx, "Znajomi", colX + 8, y + 7, Theme.TEXT_DIM, false);
        List<String> list = Friends.list();
        float hx = colX + 14 + Render2D.textWidth("Znajomi");
        int online = 0, shown = 0;
        for (String name : list) {
            NoreHub.Entry e = NoreHub.get(name);
            boolean on = e != null && e.online;
            if (on) online++;
            if (shown < 4 && hx + 16 < colX + colW - 50) {
                Album.head(ctx, Heads.get(name), hx, y + 5, 12, on ? ThemeTokens.DOT_READY : ThemeTokens.DOT_OFF);
                hx += 20;
                shown++;
            }
        }
        String right = list.isEmpty() ? "dodaj" : online + " w grze";
        Album.right(ctx, right, colX + colW - 8, y + 7, list.isEmpty() ? Theme.accentLight() : Theme.TEXT_DIM);
    }

    // ------------------------------------------------------------------ input

    @Override
    public boolean keyPressed(int key, int modifiers) {
        if (guideStep >= 0) {
            if (key == Keys.ESCAPE) endGuide();
            else if (key == Keys.ENTER || key == Keys.RIGHT) { if (guideStep >= GUIDE.length - 1) endGuide(); else guideStep++; }
            return true;
        }
        if (ipBox.isFocused()) {
            if (key == Keys.ENTER) { joinTyped(); return true; }
            if (key == Keys.ESCAPE) { ipBox.setFocused(false); return true; }
            return ipBox.keyPressed(key);
        }
        return false;
    }

    @Override
    public boolean charTyped(char c) { return ipBox.charTyped(c); }

    private void joinTyped() {
        final String addr = typedAddress();
        if (addr == null) return;
        final NoreMainMenu self = this;
        Sounds.click();
        go(() -> game().connect(addr, addr, self));
    }

    private dev.noreclient.module.client.ClientSettings settings() {
        return NoreClient.get().modules().get(dev.noreclient.module.client.ClientSettings.class);
    }

    private void openTile(int i) {
        final NoreMainMenu self = this;
        Sounds.page();
        switch (i) {
            case 0: go(() -> game().openScreen(new ScreenshotsScreen(self))); break;
            case 1: go(() -> game().openScreen(new FriendsScreen(self))); break;
            case 2: go(() -> game().openScreen(new CosmeticsScreen(self))); break;
            case 3: go(() -> game().openScreen(new ModsScreen(self))); break;
            case 4: go(() -> game().openScreen(new ShopScreen(self))); break;
            default: guideStep = 0; break;
        }
    }

    // ------------------------------------------------------------------ welcome guide

    private static final String[][] GUIDE = {
            {"Witaj w Nore Client!", "Krótki przewodnik po najważniejszych rzeczach. Zajmie 20 sekund – możesz go pominąć i wrócić do niego przyciskiem „?” obok zegara."},
            {"Moduły klienta", "Ponad 90 modułów: HUD, zoom, freelook, crosshair, Auto Craft... W grze otwierasz je Prawym Shiftem. Włączony moduł to naklejka, wyłączony – puste miejsce."},
            {"Edytor HUD", "W grze naciśnij H, aby przeciągać elementy HUD. Każdy element ma skalę i własne opcje."},
            {"Skróty", "Przyciski obok zegara: galeria zrzutów (F2), znajomi, kosmetyki, lista modów, sklep (wkrótce) i ten poradnik."},
            {"Multiplayer", "Oficjalny serwer Nore MC jest zawsze na górze listy i tutaj, jednym kliknięciem. Wpisz adres w polu poniżej, aby zobaczyć serwer, zanim wejdziesz."},
            {"Gotowe!", "Miłej gry. Kolory, tło menu, animacje i siłę efektów wydarzeń ustawisz w Moduły klienta → Client Settings."}};
    private int guideStep = -1;
    private boolean guideChecked;
    private final Animation guideAnim = new Animation(0, 10);
    private float gBtnX, gBtnY, gBtnW, gSkipX, gSkipW;

    private float[] guideTarget() {
        switch (guideStep) {
            case 1: return new float[]{navX - 2, navY + rowH * 3 - 2, navW + 4, rowH + 1};
            case 2: return new float[]{navX - 2, navY + rowH * 5 - 2, navW + 4, rowH + 1};
            case 3: return new float[]{tilesX - 3, tilesY - 3, TILE_ICONS.length * (TILE + TILE_GAP) + 2, TILE + 6};
            case 4: return joinY > -999 ? new float[]{colX - 3, joinY - 3, colW + 6, 42} : new float[]{navX - 2, navY + rowH * 2 - 2, navW + 4, rowH + 1};
            default: return null;
        }
    }

    private void renderGuide(Gfx ctx, int mx, int my) {
        float a = guideAnim.target(1).update();
        float[] t = guideTarget();
        int dim = ColorUtil.withAlpha(ThemeTokens.SCRIM, (int) (ColorUtil.alpha(ThemeTokens.SCRIM) * a));
        if (t == null) Render2D.rect(ctx, 0, 0, width, height, dim);
        else {
            Render2D.rect(ctx, 0, 0, width, t[1], dim);
            Render2D.rect(ctx, 0, t[1] + t[3], width, height - t[1] - t[3], dim);
            Render2D.rect(ctx, 0, t[1], t[0], t[3], dim);
            Render2D.rect(ctx, t[0] + t[2], t[1], width - t[0] - t[2], t[3], dim);
            Album.dashed(ctx, t[0], t[1], t[2], t[3], ColorUtil.withAlpha(Theme.accentLight(), (int) (230 * a)));
        }
        String[] step = GUIDE[guideStep];
        float w = Math.min(250, width - 40);
        List<String> lines = ModsScreen.wrap(step[1], (int) w - 20);
        float h = 30 + lines.size() * 10 + 26;
        float x = (width - w) / 2f, y = height / 2f - h / 2f;
        if (t != null) {
            x = t[0] + t[2] + 12 + w < width ? t[0] + t[2] + 12 : Math.max(10, t[0] - w - 12);
            if (x < t[0] + t[2] && x + w > t[0]) { x = (width - w) / 2f; y = t[1] + t[3] + 10 < height - h ? t[1] + t[3] + 10 : t[1] - h - 10; }
            else y = Math.max(10, Math.min(height - h - 10, t[1] + t[3] / 2f - h / 2f));
        }
        ctx.setAlpha(a);
        Album.floating(ctx, x, y, w, h, Theme.raised());
        Album.title(ctx, Render2D.trim(step[0], (int) (w - 20) / 2), x + 10, y + 9, Theme.TEXT);
        float ly = y + 30;
        for (String line : lines) {
            Render2D.text(ctx, line, x + 10, ly, Theme.TEXT_DIM, false);
            ly += 10;
        }
        for (int i = 0; i < GUIDE.length; i++) Album.dot(ctx, x + 13 + i * 8, y + h - 12, 1.8f, i == guideStep ? Theme.accent() : ThemeTokens.DOT_OFF);
        String next = guideStep == GUIDE.length - 1 ? "Zaczynamy" : "Dalej";
        gBtnW = Render2D.textWidth(next) + 18; gBtnX = x + w - gBtnW - 8; gBtnY = y + h - 20;
        boolean nh = Render2D.hovered(mx, my, gBtnX, gBtnY, gBtnW, 14);
        Album.button(ctx, gBtnX, gBtnY, gBtnW, 14, next, Album.PRIMARY, nh ? 1 : 0);
        if (guideStep < GUIDE.length - 1) {
            gSkipW = Render2D.textWidth("Pomiń") + 8; gSkipX = gBtnX - gSkipW - 6;
            Album.button(ctx, gSkipX, gBtnY, gSkipW, 14, "Pomiń", Album.QUIET, Render2D.hovered(mx, my, gSkipX, gBtnY, gSkipW, 14) ? 1 : 0);
        } else gSkipW = 0;
        ctx.setAlpha(1);
    }

    private void endGuide() {
        guideStep = -1;
        guideAnim.set(0);
        settings().welcomeGuide.set(false);
        NoreClient.get().config().save();
    }

    private boolean guideClick(double mx, double my) {
        if (guideStep < 0) return false;
        if (Render2D.hovered(mx, my, gBtnX, gBtnY, gBtnW, 14)) {
            Sounds.click();
            if (guideStep >= GUIDE.length - 1) endGuide(); else guideStep++;
        } else if (gSkipW > 0 && Render2D.hovered(mx, my, gSkipX, gBtnY, gSkipW, 14)) {
            Sounds.click();
            endGuide();
        }
        return true;
    }

    /** Leave this screen with the exit transition, then run {@code r}. */
    private void go(Runnable r) {
        if (pending == null) {
            pending = r;
            leaving = System.currentTimeMillis();
        }
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (button != 0 || pending != null) return false;
        if (dev.noreclient.cosmetic.SecretEars.menuClick(mx, my, width, height)) return true;
        if (guideClick(mx, my)) return true;
        for (int i = 0; i < TILE_ICONS.length; i++) {
            if (Render2D.hovered(mx, my, tilesX + i * (TILE + TILE_GAP), tilesY, TILE, TILE)) { openTile(i); return true; }
        }
        if (nav.click(mx, my)) {
            Sounds.click();
            return true;
        }
        if (joinY > -999 && Render2D.hovered(mx, my, colX, joinY, colW, 36)) { Sounds.click(); joinOfficial(); return true; }
        if (ipY > -999 && Render2D.hovered(mx, my, ipX, ipY, ipW, 16)) { ipBox.setFocused(true); return true; }
        ipBox.setFocused(false);
        if (ipY > -999 && Render2D.hovered(mx, my, joinX, ipY, 42, 16)) { joinTyped(); return true; }
        if (previewY > -999 && Render2D.hovered(mx, my, colX, previewY, colW, previewH)) { joinTyped(); return true; }
        for (int i = 0; i < savedShown; i++) {
            if (Render2D.hovered(mx, my, colX, serversY + i * 20, colW, 18)) {
                final String[] s = servers.get(i);
                final NoreMainMenu self = this;
                Sounds.click();
                go(() -> game().connect(s[0], s[1], self));
                return true;
            }
        }
        if (friendsY > -999 && Render2D.hovered(mx, my, colX, friendsY, colW, 22)) { openTile(1); return true; }
        return false;
    }
}
