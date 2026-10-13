package dev.noreclient.gui.menu;

import com.mojang.blaze3d.systems.RenderSystem;
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
import net.minecraft.SharedConstants;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gui.screen.multiplayer.MultiplayerScreen;
import net.minecraft.client.gui.screen.option.OptionsScreen;
import net.minecraft.client.gui.screen.world.SelectWorldScreen;
import net.minecraft.text.Text;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;

/** Custom animated title screen that replaces the vanilla one. */
public class NoreMainMenu extends Screen {
    /** Set to open the vanilla title screen once without it being replaced. */
    public static boolean bypass;

    private static final String[] LABELS = {"Singleplayer", "Multiplayer", "Moduły klienta", "Edytor HUD"};
    private static final String[] HINTS = {"Graj w swoich światach", "Dołącz do serwera", "Ustawienia i moduły", "Rozmieść nakładki"};
    private static final float BW = 210, BH = 24, GAP = 6;
    /** Only the very first menu of a session plays the long intro. */
    private static boolean firstOpen = true;

    private final long opened = System.currentTimeMillis();
    private final long introLength;
    private final Animation[] hover = new Animation[8];
    private final Animation fadeOut = new Animation(0, 9);
    private Runnable pending;

    public NoreMainMenu() {
        super(Text.literal("Nore Client"));
        for (int i = 0; i < hover.length; i++) hover[i] = new Animation(0, 14);
        introLength = firstOpen ? 1400 : 500;
        firstOpen = false;
    }

    @Override
    public boolean shouldCloseOnEsc() { return false; }

    /** 0..1 progress of an intro element that starts {@code delay} ms after opening. */
    private float stage(long delay, long duration) {
        float scaleT = introLength / 1400f;
        long t = System.currentTimeMillis() - opened - (long) (delay * scaleT);
        return Animation.easeOutCubic(t / (float) (duration * Math.max(0.4f, scaleT)));
    }

    private float logoScale() {
        float avail = height - 30 - 14 - 16 - buttonsHeight();
        return Math.max(2f, Math.min(4.5f, Math.min(width / 160f, avail / 8f)));
    }

    private float buttonsHeight() {
        return (LABELS.length + 1) * BH + LABELS.length * GAP;
    }

    private float logoY() {
        float total = 8 * logoScale() + 16 + 16 + buttonsHeight();
        return Math.max(4, (height - 20 - total) / 2f);
    }

    private float buttonsY() {
        return logoY() + 8 * logoScale() + 16 + 16;
    }

    @Override
    public void renderBackground(DrawContext ctx, int mouseX, int mouseY, float delta) {
        MenuBackground.render(ctx, width, height, mouseX, mouseY);
    }

    @Override
    public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
        renderBackground(ctx, mouseX, mouseY, delta);
        // intro: fade the whole UI in from black
        float bgIn = stage(0, 700);
        if (bgIn < 1) Render2D.rect(ctx, 0, 0, width, height, ColorUtil.withAlpha(0xFF000000, (int) (255 * (1 - bgIn))));

        float cx = width / 2f;
        float s = logoScale();
        float logoP = stage(150, 700);
        float logoY = logoY() - (1 - logoP) * 18;

        // logo with glow
        RenderSystem.setShaderColor(1, 1, 1, logoP);
        float lw = Render2D.textWidth("NORE") * s;
        double t = System.currentTimeMillis() / 1000.0;
        float pulse = 0.75f + 0.25f * (float) Math.sin(t * 1.6);
        Render2D.radial(ctx, cx, logoY + 4 * s, lw * 0.9f, ColorUtil.withAlpha(Theme.accent(), (int) (70 * pulse)), 0x00000000);
        Render2D.gradientText(ctx, "NORE", cx - lw / 2, logoY, s, Theme.accent(), Theme.accent2(), true);
        RenderSystem.setShaderColor(1, 1, 1, 1);

        float subP = stage(400, 600);
        String sub = "C  L  I  E  N  T";
        RenderSystem.setShaderColor(1, 1, 1, subP);
        float spread = 1 + (1 - subP) * 0.6f;
        Render2D.centeredText(ctx, sub, cx, logoY + 8 * s + 5, Theme.TEXT_DIM, false);
        // accent line under the subtitle growing from the centre
        float line = 60 * subP * spread;
        Render2D.roundedGradient(ctx, cx - line / 2, logoY + 8 * s + 17, line, 1.5f, 0.75f, Theme.accent(), Theme.accent2(), false);
        RenderSystem.setShaderColor(1, 1, 1, 1);

        // main buttons with staggered entrance
        float by = buttonsY();
        for (int i = 0; i <= LABELS.length; i++) {
            float p = stage(450 + i * 90L, 500);
            float y = by + i * (BH + GAP) + (1 - p) * 16;
            RenderSystem.setShaderColor(1, 1, 1, p);
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
            RenderSystem.setShaderColor(1, 1, 1, 1);
        }

        // footer + clock
        float footP = stage(900, 600);
        RenderSystem.setShaderColor(1, 1, 1, footP);
        String left = "Minecraft " + SharedConstants.getGameVersion().getName() + "  •  Fabric  •  " + NoreClient.NAME + " " + NoreClient.VERSION;
        Render2D.text(ctx, left, 6, height - 12, Theme.TEXT_MUTED, false);
        String right = "Zalogowano jako " + client.getSession().getUsername();
        Render2D.text(ctx, right, width - 6 - Render2D.textWidth(right), height - 12, Theme.TEXT_MUTED, false);
        String clock = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm"));
        Render2D.scaledText(ctx, clock, 8, 8, 1.6f, 0xFFFFFFFF, true);
        Render2D.scaledText(ctx, "Tło: NASA/ESA/CSA/STScI (JWST)", 8, 24, 0.65f, ColorUtil.withAlpha(Theme.TEXT_MUTED, 150), false);

        String van = "Menu vanilla ›";
        float vw = Render2D.textWidth(van) + 14;
        boolean hv = Render2D.hovered(mouseX, mouseY, width - vw - 6, 6, vw, 16);
        float va = hover[6].target(hv ? 1 : 0).update();
        Render2D.roundedRect(ctx, width - vw - 6, 6, vw, 16, 8, ColorUtil.lerp(0x40101018, ColorUtil.withAlpha(Theme.accent(), 170), va));
        Render2D.roundedOutline(ctx, width - vw - 6, 6, vw, 16, 8, 1, 0x30FFFFFF);
        Render2D.text(ctx, van, width - vw + 1, 10, Theme.TEXT, false);
        RenderSystem.setShaderColor(1, 1, 1, 1);

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
                switch (i) {
                    case 0 -> go(() -> client.setScreen(new SelectWorldScreen(this)));
                    case 1 -> go(() -> client.setScreen(new MultiplayerScreen(this)));
                    case 2 -> {
                        Sounds.click();
                        client.setScreen(new ClickGuiScreen(this));
                    }
                    default -> go(() -> client.setScreen(new HudEditorScreen(this)));
                }
                return true;
            }
        }
        float y = by + LABELS.length * (BH + GAP);
        float half = (BW - GAP) / 2;
        if (Render2D.hovered(mx, my, cx - BW / 2, y, half, BH)) {
            go(() -> client.setScreen(new OptionsScreen(this, client.options)));
            return true;
        }
        if (Render2D.hovered(mx, my, cx - BW / 2 + half + GAP, y, half, BH)) {
            go(client::scheduleStop);
            return true;
        }
        String van = "Menu vanilla ›";
        float vw = Render2D.textWidth(van) + 14;
        if (Render2D.hovered(mx, my, width - vw - 6, 6, vw, 16)) {
            go(() -> {
                bypass = true;
                client.setScreen(new TitleScreen());
            });
            return true;
        }
        return super.mouseClicked(mx, my, button);
    }
}
