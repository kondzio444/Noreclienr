package dev.noreclient.gui.menu;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.api.TextureRef;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.click.ClickGuiScreen;
import dev.noreclient.gui.click.RadialMenuScreen;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.widget.Album;
import dev.noreclient.gui.widget.SideNav;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.Events;
import dev.noreclient.util.Friends;
import dev.noreclient.util.Heads;
import dev.noreclient.util.LauncherChat;
import dev.noreclient.util.Motion;
import dev.noreclient.util.NoreHub;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;
import dev.noreclient.util.ThemeTokens;
import dev.noreclient.util.Thumbnails;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Comparator;
import java.util.List;

/**
 * Pause menu in the "Album" direction (design/mocks/game-pause.html): the violet "Wróć do gry" pill
 * on top, the same sticker rows as the title screen, a taped session clipping, friends, today's
 * screenshots as stickers and keycaps for F2 / P.Shift / Esc. The world stays visible.
 */
public class NorePauseMenu extends NoreScreen {
    private static final long SESSION_START = System.currentTimeMillis();

    private final long opened = System.currentTimeMillis();
    private final SideNav nav = new SideNav();
    private boolean closing;
    private long closedAt;
    private List<File> todayShots = new ArrayList<File>();
    private int todayCount;
    private float shotsY = -1000, shotsX;

    public NorePauseMenu() {
        super(null);
    }

    @Override
    public boolean pausesGame() { return true; }

    @Override
    protected void init() {
        nav.clear();
        final NorePauseMenu self = this;
        nav.add("Wróć do gry", null, SideNav.PLAY, SideNav.PRIMARY, this::close)
                .add("Moduły klienta", null, SideNav.GRID, SideNav.NORMAL, () -> game().openScreen(new RadialMenuScreen(self))).key("P.Shift")
                .add("Szatnia", null, SideNav.PERSON, SideNav.NORMAL, () -> game().openScreen(new CosmeticsScreen(self)))
                .add("Edytor HUD", null, SideNav.HUD, SideNav.NORMAL, () -> game().openScreen(new HudEditorScreen(self))).key("H")
                .add("Postępy", null, SideNav.STAR, SideNav.NORMAL, () -> game().openAdvancements(self))
                .add("Statystyki", null, SideNav.CHART, SideNav.NORMAL, () -> game().openStats(self))
                .add("Zrzuty ekranu", null, SideNav.CAMERA, SideNav.NORMAL, () -> game().openScreen(new ScreenshotsScreen(self)))
                .add(LauncherChat.unread() > 0 ? "Znajomi (" + LauncherChat.unread() + ")" : "Znajomi i czat", null, SideNav.PERSON, SideNav.NORMAL, () -> game().openScreen(new FriendsScreen(self))).key("Y")
                .add("Opcje", null, SideNav.GEAR, SideNav.NORMAL, () -> game().openOptions(self));
        if (game().canOpenLan()) nav.add("Otwórz w LAN", null, SideNav.WIFI, SideNav.NORMAL, () -> game().openLan(self));
        else nav.add("Paczki zasobów", "Modrinth", SideNav.DOWNLOAD, SideNav.NORMAL, () -> game().openScreen(ClickGuiScreen.forDownloads(self)));
        nav.add(game().singleplayer() ? "Zapisz i wyjdź" : "Rozłącz", null, SideNav.POWER, SideNav.DANGER, () -> game().disconnect());
        loadShots();
    }

    private void loadShots() {
        todayShots = new ArrayList<File>();
        todayCount = 0;
        try {
            File dir = new File(game().gameDir(), "screenshots");
            File[] files = dir.listFiles((d, n) -> n.toLowerCase().endsWith(".png"));
            if (files == null) return;
            Calendar c = Calendar.getInstance();
            c.set(Calendar.HOUR_OF_DAY, 0);
            c.set(Calendar.MINUTE, 0);
            c.set(Calendar.SECOND, 0);
            long midnight = c.getTimeInMillis();
            Arrays.sort(files, new Comparator<File>() {
                @Override public int compare(File a, File b) { return Long.compare(b.lastModified(), a.lastModified()); }
            });
            for (File f : files) {
                if (f.lastModified() < midnight) break;
                todayCount++;
                if (todayShots.size() < 3) todayShots.add(f);
            }
        } catch (Exception ignored) {
            // no screenshots folder yet
        }
    }

    @Override
    public void close() {
        if (closing) return;
        closing = true;
        closedAt = System.currentTimeMillis();
    }

    @Override
    public void render(Gfx ctx, int mouseX, int mouseY, float delta) {
        CurrentGfx.set(ctx);
        float o = 1;
        if (closing) {
            o = 1 - Motion.progress(closedAt, 0, ThemeTokens.DUR_EXIT, ThemeTokens.EASE_IN);
            if (o <= 0.01f) {
                game().openParent(null);
                return;
            }
        }
        float sp = Motion.screen(opened);
        // shade: dark on the album side, lighter over the world
        Render2D.quadGradient(ctx, 0, 0, width * 0.42f, height, ColorUtil.withAlpha(0xFF0A090C, (int) (200 * o)), ColorUtil.withAlpha(0xFF0A090C, (int) (120 * o)),
                ColorUtil.withAlpha(0xFF0A090C, (int) (120 * o)), ColorUtil.withAlpha(0xFF0A090C, (int) (200 * o)));
        Render2D.rect(ctx, width * 0.42f, 0, width * 0.58f, height, ColorUtil.withAlpha(0xFF0A090C, (int) (80 * o)));

        ctx.setAlpha(o * sp);
        float slide = ((1 - sp) * -6 - (1 - o) * 14) * Motion.travel();
        ctx.push();
        ctx.translate(slide, 0);

        float pad = 16;
        Album.logo(ctx, pad + 2, 16, 24, o * sp);
        Album.titleShadow(ctx, "Pauza", pad + 32, 17, Theme.TEXT);
        String where = game().singleplayer() ? "Świat lokalny" : (game().serverAddress() != null ? game().serverAddress() : "Serwer");
        Render2D.text(ctx, Render2D.trim(where + " · " + game().minecraftVersion(), 200), pad + 32, 35, Theme.TEXT_DIM, true);
        if (Events.any()) Album.eventDot(ctx, pad + 36 + Render2D.textWidth("Pauza") * 2 + 4, 22);

        float navW = Math.max(140, Math.min(160, width * 0.3f));
        float top = 54, bottom = height - 14;
        float rowH = Math.max(14, Math.min(21, (bottom - top - 8) / (float) nav.size()));
        float[] stages = new float[nav.size()];
        for (int i = 0; i < stages.length; i++) stages[i] = Motion.enter(opened, i + 1);
        nav.render(ctx, pad, top, navW, rowH, (int) (mouseX - slide), mouseY, !closing, stages);
        ctx.pop();

        // right column
        float cw = Math.min(196, width - navW - pad - 40);
        if (cw > 130) {
            float cx = width - cw - 14;
            float cy = 22;
            float p1 = Motion.enter(opened, 3);
            ctx.setAlpha(o * p1);
            cy = session(ctx, cx, cy + (1 - p1) * 6 * Motion.travel(), cw);
            float p2 = Motion.enter(opened, 5);
            ctx.setAlpha(o * p2);
            cy = friends(ctx, cx, cy + 10, cw);
            float p3 = Motion.enter(opened, 7);
            ctx.setAlpha(o * p3);
            shots(ctx, cx, cy + 10, cw, mouseX, mouseY);
        }

        // keycap hints
        ctx.setAlpha(o * Motion.enter(opened, 8));
        float hx = width - 14;
        String[][] hints = {{"Esc", "wróć"}, {"P.Shift", "moduły"}, {"F2", "zrzut"}};
        for (String[] h : hints) {
            float tw = Render2D.textWidth(h[1]);
            hx -= tw;
            Render2D.text(ctx, h[1], hx, height - 20, Theme.TEXT_DIM, true);
            hx -= 4 + Album.keycapWidth(h[0]);
            Album.keycap(ctx, h[0], hx, height - 21);
            hx -= 10;
        }
        ctx.setAlpha(1);
    }

    /** Taped paper clipping with the session facts. Returns the y below it. */
    private float session(Gfx ctx, float x, float y, float w) {
        String[][] rows = {
                {"Gracz", game().username()},
                {game().singleplayer() ? "Tryb" : "Serwer", game().singleplayer() ? "Świat lokalny" : (game().serverAddress() != null ? game().serverAddress() : "Serwer")},
                {game().singleplayer() ? "Wymiar" : "Ping", game().singleplayer() ? dimension() : game().ping() + " ms"},
                {"Pozycja", (int) Math.floor(game().x()) + " " + (int) Math.floor(game().y()) + " " + (int) Math.floor(game().z())},
                {"W grze", session()},
                {"Moduły", activeModules() + " włączonych"},
        };
        float h = 26 + rows.length * 11 + 6;
        Album.clipping(ctx, x, y, w, h, Events.any() ? ThemeTokens.TAPE_KRAFT : ThemeTokens.TAPE_MINT, w / 2f - 15);
        int dot = game().singleplayer() ? ThemeTokens.DOT_READY : dev.noreclient.module.utility.TabPing.color(game().ping());
        Album.dot(ctx, x + 13, y + 13, 2, dot);
        Render2D.text(ctx, "Sesja", x + 20, y + 9, Theme.VINYL_INK, false);
        if (Events.halloween()) {
            String left = "Halloween: " + Events.halloweenLeft();
            Album.dot(ctx, x + w - 14 - Render2D.textWidth(left), y + 13, 2, ThemeTokens.DOT_EVENT);
            Album.right(ctx, left, x + w - 10, y + 9, Theme.VINYL_INK_SOFT);
        }
        for (int i = 0; i < rows.length; i++) {
            float ry = y + 26 + i * 11;
            Render2D.text(ctx, rows[i][0], x + 11, ry, Theme.VINYL_INK_SOFT, false);
            String v = Render2D.trim(rows[i][1], (int) (w - 70));
            Album.right(ctx, v, x + w - 11, ry, Theme.VINYL_INK);
        }
        return y + h;
    }

    /** Friends sheet: head stickers with their state. */
    private float friends(Gfx ctx, float x, float y, float w) {
        List<String> list = Friends.list();
        int n = Math.min(3, list.size());
        float h = n == 0 ? 22 : 8 + n * 16;
        if (y + h > height - 70) return y - 10;
        Album.sheet(ctx, x, y, w, h);
        if (n == 0) {
            Render2D.text(ctx, "Znajomi – dodaj ich klawiszem Y", x + 9, y + 7, Theme.TEXT_DIM, false);
            return y + h;
        }
        for (int i = 0; i < n; i++) {
            String name = list.get(i);
            float ry = y + 6 + i * 16;
            NoreHub.Entry e = NoreHub.get(name);
            boolean on = e != null && e.online;
            Album.head(ctx, Heads.get(name), x + 9, ry, 11, 0);
            Render2D.text(ctx, Render2D.trim(name, (int) w - 90), x + 26, ry + 2, Theme.TEXT, false);
            String st = on ? "online" : "offline";
            float sw = Render2D.textWidth(st);
            Render2D.text(ctx, st, x + w - 9 - sw, ry + 2, Theme.TEXT_DIM, false);
            Album.dot(ctx, x + w - 15 - sw, ry + 6, 2, on ? ThemeTokens.DOT_READY : ThemeTokens.DOT_OFF);
        }
        return y + h;
    }

    /** Today's screenshots as small photo stickers. */
    private void shots(Gfx ctx, float x, float y, float w, int mx, int my) {
        shotsY = -1000;
        if (todayShots.isEmpty() || y + 30 > height - 30) return;
        shotsY = y;
        shotsX = x;
        float sx = x + 1;
        for (File f : todayShots) {
            TextureRef t = Thumbnails.get(f, 160);
            Render2D.roundedRect(ctx, sx - 1, y - 1, 46, 28, 3, Theme.VINYL);
            if (t != null) Render2D.texture(ctx, t, sx, y, 44, 26, 1f);
            else Render2D.roundedRect(ctx, sx, y, 44, 26, 2, Theme.SLOT);
            sx += 52;
        }
        Render2D.text(ctx, "dziś: " + todayCount, sx + 2, y + 15, Theme.TEXT_DIM, true);
    }

    private String dimension() {
        String d = game().dimension();
        if ("overworld".equals(d)) return "Overworld";
        if ("the_nether".equals(d)) return "Nether";
        if ("the_end".equals(d)) return "End";
        return d;
    }

    private static int activeModules() {
        int n = 0;
        for (dev.noreclient.module.Module m : NoreClient.get().modules().getModules()) if (m.isEnabled() && m.isToggleable()) n++;
        return n;
    }

    private static String session() {
        long m = (System.currentTimeMillis() - SESSION_START) / 60000;
        return m >= 60 ? (m / 60) + " h " + (m % 60) + " min" : m + " min";
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (button != 0 || closing) return false;
        if (nav.click(mx, my)) {
            Sounds.click();
            return true;
        }
        if (shotsY > -999 && Render2D.hovered(mx, my, shotsX, shotsY, 160, 28)) {
            Sounds.page();
            game().openScreen(new ScreenshotsScreen(this));
            return true;
        }
        return false;
    }

    @Override
    public boolean keyPressed(int key, int modifiers) {
        if (key == Keys.ESCAPE) {
            close();
            return true;
        }
        return false;
    }
}
