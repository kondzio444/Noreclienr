package dev.noreclient.gui.menu;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.click.ClickGuiScreen;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.widget.Widgets;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.List;

/** Pause menu in the client's style, replacing the vanilla game menu. */
public class NorePauseMenu extends NoreScreen {
    /** Set to open the vanilla pause screen once without it being replaced. */
    public static boolean bypass;

    private static final class Entry {
        final String label;
        final int style;
        final Runnable action;

        Entry(String label, int style, Runnable action) {
            this.label = label;
            this.style = style;
            this.action = action;
        }
    }

    private static final float BW = 220, BH = 22, GAP = 6;

    private final long opened = System.currentTimeMillis();
    private final List<Entry[]> rows = new ArrayList<Entry[]>();
    private final Animation[] hover = new Animation[16];
    private final Animation out = new Animation(0, 14);
    private boolean closing;

    public NorePauseMenu() {
        super(null);
        for (int i = 0; i < hover.length; i++) hover[i] = new Animation(0, 14);
    }

    @Override
    public boolean pausesGame() { return true; }

    @Override
    protected void init() {
        rows.clear();
        final NorePauseMenu self = this;
        rows.add(new Entry[]{new Entry("Powrót do gry", Widgets.PRIMARY, this::close)});
        rows.add(new Entry[]{
                new Entry("Moduły klienta", Widgets.NORMAL, () -> game().openScreen(new ClickGuiScreen(self))),
                new Entry("Edytor HUD", Widgets.NORMAL, () -> game().openScreen(new HudEditorScreen(self)))});
        rows.add(new Entry[]{
                new Entry("Postępy", Widgets.NORMAL, () -> game().openAdvancements(self)),
                new Entry("Statystyki", Widgets.NORMAL, () -> game().openStats(self))});
        rows.add(new Entry[]{
                new Entry("Ustawienia", Widgets.NORMAL, () -> game().openOptions(self)),
                game().canOpenLan() ? new Entry("Otwórz w LAN", Widgets.NORMAL, () -> game().openLan(self))
                        : new Entry("Menu vanilla", Widgets.NORMAL, () -> {
                    bypass = true;
                    game().openVanillaPause();
                })});
        rows.add(new Entry[]{new Entry(game().singleplayer() ? "Zapisz i wyjdź do menu" : "Rozłącz", Widgets.DANGER, () -> game().disconnect())});
    }

    @Override
    public void close() {
        closing = true;
    }

    private float stage(long delay) {
        return Animation.easeOutCubic((System.currentTimeMillis() - opened - delay) / 350f);
    }

    private float panelHeight() { return 52 + rows.size() * (BH + GAP); }

    private float top() { return (height - panelHeight()) / 2f; }

    @Override
    public void render(Gfx ctx, int mouseX, int mouseY, float delta) {
        CurrentGfx.set(ctx);
        float o = closing ? 1 - out.target(1).update() : 1;
        if (closing && o < 0.03f) {
            game().openParent(null);
            return;
        }
        ctx.setAlpha(o);
        Render2D.quadGradient(ctx, 0, 0, width, height, ColorUtil.withAlpha(Theme.accent(), 50), 0x40000000, ColorUtil.withAlpha(Theme.accent2(), 40), 0x70000000);
        float cx = width / 2f, y = top();
        float hp = stage(0);
        ctx.setAlpha(o * hp);
        float ty = y - (1 - hp) * 10;
        float titleW = Render2D.textWidth("PAUZA") * 2f;
        float lx = cx - (titleW + 26) / 2f;
        Render2D.logo(ctx, lx, ty - 4, 22, 1f);
        Render2D.gradientText(ctx, "PAUZA", lx + 26, ty, 2f, Theme.accent2(), Theme.accent(), true);
        String info = sessionInfo();
        float iw = Render2D.textWidth(info) + 20;
        Render2D.roundedRect(ctx, cx - iw / 2, ty + 22, iw, 16, 8, 0xA0140F0C);
        Render2D.roundedOutline(ctx, cx - iw / 2, ty + 22, iw, 16, 8, 1, 0x25FFFFFF);
        Render2D.circle(ctx, cx - iw / 2 + 9, ty + 30, 2.5f, Theme.SUCCESS);
        Render2D.text(ctx, info, cx - iw / 2 + 15, ty + 26, Theme.TEXT_DIM, false);

        float by = y + 52;
        int idx = 0;
        for (int r = 0; r < rows.size(); r++) {
            Entry[] row = rows.get(r);
            float p = stage(60 + r * 55L);
            ctx.setAlpha(o * Math.max(0, p));
            float ry = by + r * (BH + GAP) + (1 - p) * 14;
            float w = (BW - GAP * (row.length - 1)) / row.length;
            for (int c = 0; c < row.length; c++) {
                float bx = cx - BW / 2 + c * (w + GAP);
                boolean hov = p > 0.9f && !closing && Render2D.hovered(mouseX, mouseY, bx, ry, w, BH);
                Widgets.menuButton(ctx, bx, ry, w, BH, row[c].label, null, hover[idx].target(hov ? 1 : 0).update(), row[c].style);
                idx++;
            }
        }
        ctx.setAlpha(o);
        Render2D.scaledText(ctx, NoreClient.NAME + " " + NoreClient.VERSION + " • Minecraft " + game().minecraftVersion(), 6, height - 10, 0.75f, Theme.TEXT_MUTED, false);
        ctx.setAlpha(1);
    }

    private String sessionInfo() {
        String name = game().username();
        if (game().singleplayer()) return name + "  •  Świat lokalny";
        String addr = game().serverAddress();
        return name + "  •  " + (addr != null ? addr : "Serwer") + "  •  " + game().ping() + "ms";
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (button != 0 || closing) return false;
        float cx = width / 2f, by = top() + 52;
        for (int r = 0; r < rows.size(); r++) {
            Entry[] row = rows.get(r);
            float ry = by + r * (BH + GAP);
            float w = (BW - GAP * (row.length - 1)) / row.length;
            for (int c = 0; c < row.length; c++) {
                float bx = cx - BW / 2 + c * (w + GAP);
                if (Render2D.hovered(mx, my, bx, ry, w, BH)) {
                    Sounds.click();
                    row[c].action.run();
                    return true;
                }
            }
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
