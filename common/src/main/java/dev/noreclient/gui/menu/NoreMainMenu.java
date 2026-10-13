package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.NoreClient;
import dev.noreclient.gui.click.ClickGuiScreen;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.widget.Widgets;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.MenuBackground;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;

/** Custom animated title screen that replaces the vanilla one. */
public class NoreMainMenu extends NoreScreen {
    private static final String[] LABELS = {"Singleplayer", "Multiplayer", "Moduły klienta", "Edytor HUD"};
    private static final String[] HINTS = {"Graj w swoich światach", "Dołącz do serwera", "Ustawienia i moduły", "Rozmieść nakładki"};
    private static final float BW = 210;
    private float BH = 24, GAP = 6;
    /** Only the very first menu of a session plays the long intro. */
    private static boolean firstOpen = true;

    private final long opened = System.currentTimeMillis();
    private final long introLength;
    private final Animation[] hover = new Animation[8];
    private final Animation fadeOut = new Animation(0, 9);
    private Runnable pending;

    public NoreMainMenu() {
        super(null);
        for (int i = 0; i < hover.length; i++) hover[i] = new Animation(0, 14);
        introLength = firstOpen ? 1400 : 500;
        firstOpen = false;
    }

    @Override
    public boolean keyPressed(int key, int modifiers) { return false; }

    @Override
    public Background background() { return Background.NONE; }

    /** 0..1 progress of an intro element that starts {@code delay} ms after opening. */
    private float stage(long delay, long duration) {
        float scaleT = introLength / 1400f;
        long t = System.currentTimeMillis() - opened - (long) (delay * scaleT);
        return Animation.easeOutCubic(t / (float) (duration * Math.max(0.4f, scaleT)));
    }

    /** Pixel size of the logo image; shrinks on small windows. */
    private float logoSize() {
        boolean small = height < 300;
        BH = small ? 20 : 24;
        GAP = small ? 4 : 6;
        float avail = height - 30 - HEAD_TEXT - 18 - buttonsHeight();
        return Math.max(0f, Math.min(96f, Math.min(width / 7f, avail)));
    }

    private static final float HEAD_TEXT = 4 + 16 + 5 + 10 + 6;

    private float buttonsHeight() {
        return (LABELS.length + 1) * BH + LABELS.length * GAP;
    }

    private float logoY() {
        float total = logoSize() + HEAD_TEXT + 18 + buttonsHeight();
        return Math.max(4, (height - 20 - total) / 2f);
    }

    private float buttonsY() {
        return logoY() + logoSize() + HEAD_TEXT + 18;
    }

    private void renderBackground(Gfx ctx, int mouseX, int mouseY, float delta) {
        MenuBackground.render(ctx, width, height, mouseX, mouseY);
    }

    @Override
    public void render(Gfx ctx, int mouseX, int mouseY, float delta) {
        CurrentGfx.set(ctx);
        renderBackground(ctx, mouseX, mouseY, delta);
        // intro: fade the whole UI in from black
        float bgIn = stage(0, 700);
        if (bgIn < 1) Render2D.rect(ctx, 0, 0, width, height, ColorUtil.withAlpha(0xFF000000, (int) (255 * (1 - bgIn))));

        float cx = width / 2f;
        float L = logoSize();
        float logoP = stage(150, 800);
        float logoY = logoY() - (1 - logoP) * 18;
        float pop = 0.85f + 0.15f * Animation.easeOutBack(Math.min(1, logoP));

        // logo image with pulsing glow
        float ls = L * pop;
        if (L >= 16) Render2D.logo(ctx, cx - ls / 2f, logoY + (L - ls) / 2f, ls, logoP);

        float subP = stage(400, 600);
        ctx.setAlpha(subP);
        float ty = logoY + L + 4;
        String title = "NORE CLIENT";
        float tw = Render2D.textWidth(title) * 2f;
        Render2D.gradientText(ctx, title, cx - tw / 2f, ty, 2f, Theme.accent2(), Theme.accent(), true);
        String sub = "Minecraft " + game().minecraftVersion() + "  \u2022  PvP & QoL";
        Render2D.scaledText(ctx, sub, cx - Render2D.textWidth(sub) * 0.4f, ty + 21, 0.8f, Theme.TEXT_DIM, false);
        // accent line growing from the centre
        float line = 70 * subP;
        Render2D.radial(ctx, cx, ty + 33, 40 * subP, ColorUtil.withAlpha(Theme.accent(), 60), 0x00000000);
        Render2D.roundedGradient(ctx, cx - line / 2, ty + 32, line, 1.5f, 0.75f, Theme.accent2(), Theme.accent(), false);
        ctx.setAlpha(1);

        // main buttons with staggered entrance
        float by = buttonsY();
        for (int i = 0; i <= LABELS.length; i++) {
            float p = stage(450 + i * 90L, 500);
            float y = by + i * (BH + GAP) + (1 - p) * 16;
            ctx.setAlpha(p);
            if (i < LABELS.length) {
                boolean hov = p > 0.9f && Render2D.hovered(mouseX, mouseY, cx - BW / 2, y, BW, BH);
                float h = hover[i].target(hov ? 1 : 0).update();
                Widgets.menuButton(ctx, cx - BW / 2, y, BW, BH, LABELS[i], HINTS[i], h, i == 0 ? Widgets.PRIMARY : Widgets.NORMAL);
            } else {
                float half = (BW - GAP) / 2;
                boolean ho = Render2D.hovered(mouseX, mouseY, cx - BW / 2, y, half, BH);
                boolean hq = Render2D.hovered(mouseX, mouseY, cx - BW / 2 + half + GAP, y, half, BH);
                Widgets.menuButton(ctx, cx - BW / 2, y, half, BH, "Opcje", null, hover[4].target(ho ? 1 : 0).update(), Widgets.NORMAL);
                Widgets.menuButton(ctx, cx - BW / 2 + half + GAP, y, half, BH, "Wyjdź", null, hover[5].target(hq ? 1 : 0).update(), Widgets.DANGER);
            }
            ctx.setAlpha(1);
        }

        // footer + clock
        float footP = stage(900, 600);
        ctx.setAlpha(footP);
        String left = "Minecraft " + game().minecraftVersion() + "  •  Fabric  •  " + NoreClient.NAME + " " + NoreClient.VERSION;
        Render2D.text(ctx, left, 6, height - 12, Theme.TEXT_MUTED, false);
        String right = "Zalogowano jako " + game().username();
        Render2D.text(ctx, right, width - 6 - Render2D.textWidth(right), height - 12, Theme.TEXT_MUTED, false);
        String clock = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm"));
        Render2D.scaledText(ctx, clock, 8, 8, 1.6f, 0xFFFFFFFF, true);
        Render2D.scaledText(ctx, "Tło: NASA/ESA/CSA/STScI (JWST)", 8, 24, 0.65f, ColorUtil.withAlpha(Theme.TEXT_MUTED, 150), false);

        String van = "\u2b07 Pobieraj zasoby";
        float vw = Render2D.textWidth(van) + 14;
        boolean hv = Render2D.hovered(mouseX, mouseY, width - vw - 6, 6, vw, 16);
        float va = hover[6].target(hv ? 1 : 0).update();
        Render2D.roundedRect(ctx, width - vw - 6, 6, vw, 16, 8, ColorUtil.lerp(0x40140F0C, ColorUtil.withAlpha(Theme.accent(), 170), va));
        Render2D.roundedOutline(ctx, width - vw - 6, 6, vw, 16, 8, 1, 0x30FFFFFF);
        Render2D.text(ctx, van, width - vw + 1, 10, Theme.TEXT, false);
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

    private void go(Runnable r) {
        Sounds.click();
        if (pending == null) pending = r;
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (button != 0 || pending != null) return false;
        float cx = width / 2f;
        float by = buttonsY();
        for (int i = 0; i < LABELS.length; i++) {
            float y = by + i * (BH + GAP);
            if (Render2D.hovered(mx, my, cx - BW / 2, y, BW, BH)) {
                final NoreMainMenu self = this;
                if (i == 0) go(() -> game().openSingleplayer(self));
                else if (i == 1) go(() -> game().openMultiplayer(self));
                else if (i == 2) { Sounds.click(); game().openScreen(new ClickGuiScreen(self)); }
                else go(() -> game().openScreen(new HudEditorScreen(self)));
                return true;
            }
        }
        float y = by + LABELS.length * (BH + GAP);
        float half = (BW - GAP) / 2;
        if (Render2D.hovered(mx, my, cx - BW / 2, y, half, BH)) {
            final NoreMainMenu self = this;
            go(() -> game().openOptions(self));
            return true;
        }
        if (Render2D.hovered(mx, my, cx - BW / 2 + half + GAP, y, half, BH)) {
            go(() -> game().quit());
            return true;
        }
        String van = "\u2b07 Pobieraj zasoby";
        float vw = Render2D.textWidth(van) + 14;
        if (Render2D.hovered(mx, my, width - vw - 6, 6, vw, 16)) {
            Sounds.click();
            game().openScreen(ClickGuiScreen.forDownloads(this));
            return true;
        }
        return false;
    }
}
