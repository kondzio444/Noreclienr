package dev.noreclient.gui.menu;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.click.ClickGuiScreen;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.gui.widget.SideNav;
import dev.noreclient.gui.widget.Widgets;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.MenuBackground;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Title screen in the style of modern PvP clients: navigation on the left over a dark gradient,
 * clock, quick-join for saved servers and a "what's new" card on the right.
 */
public class NoreMainMenu extends NoreScreen {
    private static final String[] NEWS = {
            "Auto Craft – jedno kliknięcie przy ekwipunku",
            "Discord RPC i 12 nowych modułów",
            "Ekrany Minecrafta w stylu Nore",
            "Szybsze renderowanie + Sodium",
    };

    /** Only the first menu of a session plays the long intro. */
    private static boolean firstOpen = true;

    private final long opened = System.currentTimeMillis();
    private final float introScale;
    private final SideNav nav = new SideNav();
    private final Animation[] hover = new Animation[16];
    private final Animation fadeOut = new Animation(0, 9);
    private List<String[]> servers = new ArrayList<String[]>();
    private Runnable pending;

    // layout of the last frame (for clicks)
    private float navX, navY, navW, rowH, cardX, cardW, serversY;

    public NoreMainMenu() {
        super(null);
        for (int i = 0; i < hover.length; i++) hover[i] = new Animation(0, 14);
        introScale = firstOpen ? 1f : 0.45f;
        firstOpen = false;
    }

    @Override
    protected void init() {
        nav.clear();
        final NoreMainMenu self = this;
        nav.add("Singleplayer", "Twoje światy", SideNav.PLAY, SideNav.PRIMARY, () -> go(() -> game().openSingleplayer(self)))
                .add("Multiplayer", "Serwery", SideNav.GLOBE, SideNav.NORMAL, () -> go(() -> game().openMultiplayer(self)))
                .add("Moduły klienta", NoreClient.get().modules().getModules().size() + " modułów", SideNav.GRID, SideNav.NORMAL, () -> game().openScreen(new ClickGuiScreen(self)))
                .add("Edytor HUD", "Nakładki", SideNav.HUD, SideNav.NORMAL, () -> go(() -> game().openScreen(new HudEditorScreen(self))))
                .add("Paczki zasobów", "Modrinth", SideNav.DOWNLOAD, SideNav.NORMAL, () -> game().openScreen(ClickGuiScreen.forDownloads(self)))
                .add("Opcje", "Ustawienia gry", SideNav.GEAR, SideNav.NORMAL, () -> go(() -> game().openOptions(self)))
                .add("Wyjdź", null, SideNav.POWER, SideNav.DANGER, () -> go(() -> game().quit()));
        try {
            servers = game().serverList();
        } catch (Exception e) {
            servers = new ArrayList<String[]>();
        }
    }

    @Override
    public boolean keyPressed(int key, int modifiers) { return false; }

    @Override
    public Background background() { return Background.NONE; }

    private float stage(long delay, long duration) {
        long t = System.currentTimeMillis() - opened - (long) (delay * introScale);
        return Animation.easeOutCubic(t / (float) (duration * Math.max(0.5f, introScale)));
    }

    @Override
    public void render(Gfx ctx, int mouseX, int mouseY, float delta) {
        CurrentGfx.set(ctx);
        MenuBackground.render(ctx, width, height, mouseX, mouseY);
        float bgIn = stage(0, 700);
        if (bgIn < 1) Render2D.rect(ctx, 0, 0, width, height, ColorUtil.withAlpha(0xFF000000, (int) (255 * (1 - bgIn))));

        // dark glass side panel
        float panelW = Math.max(170, Math.min(230, width * 0.34f));
        float slide = (1 - stage(100, 700)) * -40;
        ctx.push();
        ctx.translate(slide, 0);
        Render2D.quadGradient(ctx, 0, 0, panelW + 60, height, 0xE6080605, 0x00080605, 0x00080605, 0xE6080605);
        Render2D.rect(ctx, 0, 0, panelW, height, 0x70080605);
        Render2D.quadGradient(ctx, panelW - 1, 0, 1, height / 2f, 0, ColorUtil.withAlpha(Theme.accent(), 0), ColorUtil.withAlpha(Theme.accent(), 120), ColorUtil.withAlpha(Theme.accent(), 120));
        Render2D.quadGradient(ctx, panelW - 1, height / 2f, 1, height / 2f, ColorUtil.withAlpha(Theme.accent(), 120), ColorUtil.withAlpha(Theme.accent(), 120), 0, 0);

        float pad = 18;
        float logoP = stage(200, 700);
        ctx.setAlpha(logoP);
        float logoS = 30;
        Render2D.radial(ctx, pad + logoS / 2f, 26 + logoS / 2f, logoS * 1.3f, ColorUtil.withAlpha(Theme.accent(), 70), ColorUtil.withAlpha(Theme.accent(), 0));
        Render2D.logo(ctx, pad, 26, logoS, logoP);
        Render2D.gradientText(ctx, "NORE", pad + logoS + 8, 28, 1.9f, Theme.accent2(), Theme.accent(), true);
        Render2D.scaledText(ctx, "CLIENT " + NoreClient.VERSION, pad + logoS + 9, 45, 0.7f, Theme.TEXT_MUTED, false);
        ctx.setAlpha(1);

        // navigation
        // rows shrink on small windows so the list never runs into the account card
        rowH = Math.max(15, Math.min(23, (height - 64 - 44 - 8) / (float) nav.size()));
        navX = pad - 6;
        navW = panelW - pad * 2 + 12;
        float totalNav = nav.height(rowH);
        navY = Math.max(62, Math.min((height - totalNav) / 2f + 10, height - totalNav - 44));
        float[] stages = new float[nav.size()];
        for (int i = 0; i < stages.length; i++) stages[i] = stage(320 + i * 70L, 480);
        nav.render(ctx, navX, navY, navW, rowH, (int) (mouseX - slide), mouseY, pending == null, stages);

        // account card
        float accP = stage(800, 500);
        ctx.setAlpha(accP);
        float ay = height - 38;
        Render2D.roundedRect(ctx, navX, ay, navW, 28, Theme.radius(), 0x90140F0C);
        Render2D.roundedOutline(ctx, navX, ay, navW, 28, Theme.radius(), 1, 0x22FFFFFF);
        Icons.tile(ctx, dev.noreclient.module.Category.PLAYER, navX + 5, ay + 5, 18, 0);
        Render2D.text(ctx, Render2D.trim(game().username(), (int) navW - 40), navX + 28, ay + 6, Theme.TEXT, false);
        Render2D.scaledText(ctx, "Minecraft " + game().minecraftVersion(), navX + 28, ay + 17, 0.65f, Theme.TEXT_MUTED, false);
        ctx.setAlpha(1);
        ctx.pop();

        // right side: clock, news and quick join
        float rp = stage(600, 700);
        ctx.setAlpha(rp);
        float rx = width - 14;
        Date now = new Date();
        String clock = new SimpleDateFormat("HH:mm", Locale.ROOT).format(now);
        String date = new SimpleDateFormat("EEEE, d MMMM", new Locale("pl", "PL")).format(now);
        Render2D.scaledText(ctx, clock, rx - Render2D.textWidth(clock) * 2.2f, 14, 2.2f, 0xFFFFFFFF, true);
        Render2D.scaledText(ctx, date, rx - Render2D.textWidth(date) * 0.8f, 34, 0.8f, Theme.TEXT_DIM, true);

        cardW = Math.min(190, width - panelW - 40);
        cardX = width - cardW - 14;
        float cy = 54 + (1 - rp) * 10;
        if (cardW > 120) {
            // what's new
            float nh = 22 + NEWS.length * 11 + 6;
            if (cy + nh < height - 60) {
                card(ctx, cardX, cy, cardW, nh);
                Icons.sparkle(ctx, cardX + 10, cy + 10, 4, Theme.accent2());
                Render2D.text(ctx, "Nowe w " + NoreClient.VERSION, cardX + 18, cy + 6.5f, Theme.TEXT, false);
                for (int i = 0; i < NEWS.length; i++) {
                    Render2D.circle(ctx, cardX + 10, cy + 25 + i * 11, 1.3f, Theme.accent());
                    Render2D.scaledText(ctx, Render2D.trim(NEWS[i], (int) ((cardW - 22) / 0.72f)), cardX + 15, cy + 22.5f + i * 11, 0.72f, Theme.TEXT_DIM, false);
                }
                cy += nh + 8;
            }
            // quick join
            int count = Math.min(3, servers.size());
            float sh = 22 + Math.max(1, count) * 20 + 4;
            if (cy + sh < height - 22) {
                card(ctx, cardX, cy, cardW, sh);
                Icons.globe(ctx, cardX + 10, cy + 10, 8, Theme.accent());
                Render2D.text(ctx, "Szybkie dołączanie", cardX + 18, cy + 6.5f, Theme.TEXT, false);
                serversY = cy + 21;
                if (count == 0) Render2D.scaledText(ctx, "Dodaj serwer w Multiplayer", cardX + 9, cy + 26, 0.72f, Theme.TEXT_MUTED, false);
                for (int i = 0; i < count; i++) {
                    String[] s = servers.get(i);
                    float y = serversY + i * 20;
                    boolean hov = rp > 0.9f && Render2D.hovered(mouseX, mouseY, cardX + 4, y, cardW - 8, 18);
                    float h = hover[10 + i].target(hov ? 1 : 0).update();
                    if (h > 0.01f) Render2D.roundedRect(ctx, cardX + 4, y, cardW - 8, 18, Theme.radius() * 0.7f, ColorUtil.withAlpha(Theme.accent(), (int) (40 * h)));
                    Render2D.text(ctx, Render2D.trim(s[0], (int) cardW - 60), cardX + 9, y + 2.5f, Theme.TEXT, false);
                    Render2D.scaledText(ctx, Render2D.trim(s[1], (int) ((cardW - 60) / 0.65f)), cardX + 9, y + 12, 0.65f, Theme.TEXT_MUTED, false);
                    float bw = 38;
                    Widgets.glowBox(ctx, cardX + cardW - bw - 8, y + 3, bw, 12, 6, Theme.accent(), h, 0.8f);
                    Render2D.scaledText(ctx, "Dołącz", cardX + cardW - bw - 8 + (bw - Render2D.textWidth("Dołącz") * 0.7f) / 2f, y + 6.3f, 0.7f, Widgets.glowText(Theme.accent(), h), false);
                }
            } else {
                serversY = -1000;
            }
        }
        Render2D.scaledText(ctx, "Tło: NASA/ESA/CSA/STScI (JWST)", rx - Render2D.textWidth("Tło: NASA/ESA/CSA/STScI (JWST)") * 0.6f, height - 9, 0.6f, ColorUtil.withAlpha(Theme.TEXT_MUTED, 150), false);
        ctx.setAlpha(1);

        // fade-out transition before switching screen
        if (pending != null) {
            float f = fadeOut.target(1).update();
            Render2D.rect(ctx, 0, 0, width, height, ColorUtil.withAlpha(0xFF05050A, (int) (255 * f)));
            if (f > 0.97f) {
                Runnable r = pending;
                pending = null;
                fadeOut.set(0);
                r.run();
            }
        }
    }

    private static void card(Gfx ctx, float x, float y, float w, float h) {
        float r = Theme.radius();
        Render2D.shadow(ctx, x, y, w, h, r, 6, 0x70000000);
        Render2D.roundedRect(ctx, x, y, w, h, r, 0xC8120E0B);
        Render2D.roundedOutline(ctx, x, y, w, h, r, 1, 0x26FFFFFF);
        Render2D.quadGradient(ctx, x + 8, y, w - 16, 1, 0, ColorUtil.withAlpha(Theme.accent(), 150), ColorUtil.withAlpha(Theme.accent(), 150), 0);
    }

    private void go(Runnable r) {
        if (pending == null) pending = r;
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (button != 0 || pending != null) return false;
        if (nav.click(mx, my)) {
            Sounds.click();
            return true;
        }
        int count = Math.min(3, servers.size());
        for (int i = 0; i < count; i++) {
            if (Render2D.hovered(mx, my, cardX + 4, serversY + i * 20, cardW - 8, 18)) {
                final String[] s = servers.get(i);
                final NoreMainMenu self = this;
                Sounds.click();
                go(() -> game().connect(s[0], s[1], self));
                return true;
            }
        }
        return false;
    }
}
