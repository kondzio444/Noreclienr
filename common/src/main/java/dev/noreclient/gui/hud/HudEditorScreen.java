package dev.noreclient.gui.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.NoreClient;
import dev.noreclient.gui.click.ClickGuiScreen;
import dev.noreclient.gui.widget.Album;
import dev.noreclient.util.Motion;
import dev.noreclient.module.HudModule;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Drag &amp; drop editor for all HUD overlays: move with the mouse (with snapping guides), scroll to
 * resize, right click for settings, toggle elements from the side panel.
 */
public class HudEditorScreen extends NoreScreen {
    private static final float SNAP = 4;

    private final Map<Object, Animation> anims = new HashMap<>();
    private final Animation fade = new Animation(0, 8);
    private final Animation panel = new Animation(0, 12);
    private boolean panelOpen;

    private HudModule dragging;
    private float dragOffX, dragOffY;
    private Float guideX, guideY;
    private boolean showGrid = true;

    public HudEditorScreen(Object parent) {
        super(parent);
    }

    private Animation anim(Object k) {
        return anims.computeIfAbsent(k, x -> new Animation(0, 14));
    }

    private List<HudModule> huds() {
        return NoreClient.get().modules().getHudModules();
    }

    @Override
    public boolean pausesGame() { return false; }

    private static boolean open;

    public static boolean isOpen() { return open; }

    @Override
    protected void init() { open = true; }

    @Override
    public void removed() { open = false; }

    @Override
    public Background background() { return Background.NONE; }

    private void renderBackground(Gfx context, int mouseX, int mouseY, float delta) {
        if (!game().inWorld()) dev.noreclient.util.MenuBackground.render(context, width, height, mouseX, mouseY);
        Render2D.rect(context, 0, 0, width, height, 0x50000000);
    }

    @Override
    public void render(Gfx ctx, int mouseX, int mouseY, float delta) {
        dev.noreclient.util.CurrentGfx.set(ctx);
        open = true;
        float f = fade.target(1).update();
        renderBackground(ctx, mouseX, mouseY, delta);

        if (showGrid) {
            int grid = ColorUtil.fade(0x10FFFFFF, f);
            for (int x = 0; x < width; x += 20) Render2D.rect(ctx, x, 0, 1, height, grid);
            for (int y = 0; y < height; y += 20) Render2D.rect(ctx, 0, y, width, 1, grid);
            Render2D.rect(ctx, width / 2f - 0.5f, 0, 1, height, ColorUtil.fade(0x18FFFFFF, f));
            Render2D.rect(ctx, 0, height / 2f - 0.5f, width, 1, ColorUtil.fade(0x18FFFFFF, f));
        }

        if (dragging != null) {
            float nx = mouseX - dragOffX, ny = mouseY - dragOffY;
            guideX = null;
            guideY = null;
            if (!game().shiftDown()) {
                float[] snapped = snap(dragging, nx, ny);
                nx = snapped[0];
                ny = snapped[1];
            }
            dragging.setPosition(nx, ny, width, height);
        }

        HudModule hovered = hoveredModule(mouseX, mouseY);
        for (HudModule h : huds()) {
            if (!h.isEnabled()) continue;
            HudRenderer.renderModule(ctx, h, width, height, delta, true);
            float x = h.getX(width), y = h.getY(height), w = h.getScaledWidth(), hh = h.getScaledHeight();
            boolean hov = h == hovered || h == dragging;
            float a = anim(h).target(hov ? 1 : 0).update();
            // at rest every element shows its die line; the hovered / dragged one gets the vinyl rim and a label sticker
            Album.dashed(ctx, x - 2, y - 2, w + 4, hh + 4, ColorUtil.lerp(0x90FBFAF7, Theme.VINYL, a));
            if (a > 0.05f) {
                Render2D.roundedOutline(ctx, x - 3, y - 3, w + 6, hh + 6, 3, 1, ColorUtil.withAlpha(Theme.VINYL, (int) (255 * a)));
                Render2D.rect(ctx, x - 2, y - 2, w + 4, hh + 4, ColorUtil.withAlpha(Theme.accent(), (int) (22 * a)));
                String label = h.getName() + " · " + String.format("%.0f%%", h.scale.get() * 100);
                float ly = y - 15 < 0 ? y + hh + 5 : y - 15;
                ctx.setAlpha(a);
                Album.label(ctx, label, x - 2, ly, Theme.VINYL, Theme.VINYL_INK);
                ctx.setAlpha(1);
            }
        }

        if (guideX != null) Render2D.rect(ctx, guideX - 0.5f, 0, 1, height, Theme.accent());
        if (guideY != null) Render2D.rect(ctx, 0, guideY - 0.5f, width, 1, Theme.accent());

        renderToolbar(ctx, mouseX, mouseY, f);
        renderPanel(ctx, mouseX, mouseY);
    }

    private void renderToolbar(Gfx ctx, int mx, int my, float f) {
        String help = width > 520 ? "Przeciągnij · Scroll: rozmiar · PPM: ustawienia · Shift: bez przyciągania" : "Przeciągnij · Scroll · PPM · Shift";
        float hw = Render2D.textWidth(help) + 16;
        float bw = 74, bh = 16, gap = 6;
        float total = bw * 4 + gap * 3;
        float x = width / 2f - total / 2f, y = height - bh - 10;
        float hy = y - 20 + (1 - f) * 8 * Motion.travel();
        ctx.setAlpha(f);
        Render2D.roundedRect(ctx, width / 2f - hw / 2, hy, hw, 14, Album.R, ColorUtil.withAlpha(Theme.page(), 0xE0));
        Render2D.text(ctx, help, width / 2f - hw / 2 + 8, hy + 3, Theme.TEXT_DIM, false);
        y += (1 - f) * 20 * Motion.travel();
        String[] labels = {"Elementy", "Moduły", showGrid ? "Siatka: wł." : "Siatka: wył.", "Gotowe"};
        for (int i = 0; i < 4; i++) {
            float bx = x + i * (bw + gap);
            boolean hov = Render2D.hovered(mx, my, bx, y, bw, bh);
            Album.button(ctx, bx, y, bw, bh, labels[i], i == 3 ? Album.PRIMARY : i == 0 && panelOpen ? Album.WHITE : Album.SECONDARY, anim("tb" + i).target(hov ? 1 : 0).update());
        }
        ctx.setAlpha(1);
    }

    private void renderPanel(Gfx ctx, int mx, int my) {
        float p = Animation.easeOutCubic(panel.target(panelOpen ? 1 : 0).update());
        if (p < 0.01f) return;
        List<HudModule> list = huds();
        float pw = 150, ph = Math.min(height - 40, 26 + list.size() * 18 + 6);
        float x = 8 - (1 - p) * (pw + 12), y = 26;
        Album.floating(ctx, x, y, pw, ph, Theme.raised());
        Album.spine(ctx, x, y, ph);
        Render2D.text(ctx, "Elementy HUD", x + 11, y + 8, Theme.TEXT);
        float ry = y + 24;
        for (HudModule h : list) {
            if (ry + 16 > y + ph) break;
            boolean hov = Render2D.hovered(mx, my, x + 4, ry, pw - 8, 16);
            if (hov) Render2D.roundedRect(ctx, x + 6, ry, pw - 10, 16, Album.R, Theme.RAISED_2);
            Render2D.text(ctx, Render2D.trim(h.getName(), (int) pw - 50), x + 11, ry + 4, h.isEnabled() ? Theme.TEXT : Theme.TEXT_MUTED);
            Album.toggle(ctx, x + pw - 30, ry + 3, 22, 10, anim("pt_" + h.getName()).target(h.isEnabled() ? 1 : 0).update());
            ry += 18;
        }
    }

    private boolean panelClick(double mx, double my) {
        if (!panelOpen) return false;
        List<HudModule> list = huds();
        float pw = 150, ph = Math.min(height - 40, 26 + list.size() * 18 + 6);
        float x = 8, y = 26;
        if (!Render2D.hovered(mx, my, x, y, pw, ph)) return false;
        float ry = y + 24;
        for (HudModule h : list) {
            if (ry + 16 > y + ph) break;
            if (Render2D.hovered(mx, my, x + 4, ry, pw - 8, 16)) {
                h.toggle();
                Sounds.toggle(h.isEnabled());
                return true;
            }
            ry += 18;
        }
        return true;
    }

    private boolean toolbarClick(double mx, double my) {
        float bw = 74, bh = 16, gap = 6;
        float total = bw * 4 + gap * 3;
        float x = width / 2f - total / 2f, y = height - bh - 10;
        for (int i = 0; i < 4; i++) {
            float bx = x + i * (bw + gap);
            if (!Render2D.hovered(mx, my, bx, y, bw, bh)) continue;
            Sounds.click();
            switch (i) {
                case 0: panelOpen = !panelOpen; break;
                case 1: game().openScreen(new ClickGuiScreen(this)); break;
                case 2: showGrid = !showGrid; break;
                default: close();
            }
            return true;
        }
        return false;
    }

    private HudModule hoveredModule(double mx, double my) {
        List<HudModule> list = huds();
        for (int i = list.size() - 1; i >= 0; i--) {
            HudModule h = list.get(i);
            if (!h.isEnabled()) continue;
            if (Render2D.hovered(mx, my, h.getX(width) - 2, h.getY(height) - 2, h.getScaledWidth() + 4, h.getScaledHeight() + 4)) return h;
        }
        return null;
    }

    /** Snaps the element's edges / centre to screen edges, the screen centre and other elements. */
    private float[] snap(HudModule m, float x, float y) {
        float w = m.getScaledWidth(), h = m.getScaledHeight();
        float bestDx = SNAP + 1, bestDy = SNAP + 1;
        float sx = x, sy = y;
        float[] xs = {0, width / 2f, width};
        float[] ys = {0, height / 2f, height};
        float[][] xEdges = {{x, 0}, {x + w / 2f, w / 2f}, {x + w, w}};
        float[][] yEdges = {{y, 0}, {y + h / 2f, h / 2f}, {y + h, h}};
        for (float[] e : xEdges) {
            for (float t : xs) {
                float d = Math.abs(e[0] - t);
                if (d < bestDx) { bestDx = d; sx = t - e[1]; guideX = t; }
            }
            for (HudModule o : huds()) {
                if (o == m || !o.isEnabled()) continue;
                float ox = o.getX(width), ow = o.getScaledWidth();
                for (float t : new float[]{ox, ox + ow / 2f, ox + ow}) {
                    float d = Math.abs(e[0] - t);
                    if (d < bestDx) { bestDx = d; sx = t - e[1]; guideX = t; }
                }
            }
        }
        for (float[] e : yEdges) {
            for (float t : ys) {
                float d = Math.abs(e[0] - t);
                if (d < bestDy) { bestDy = d; sy = t - e[1]; guideY = t; }
            }
            for (HudModule o : huds()) {
                if (o == m || !o.isEnabled()) continue;
                float oy = o.getY(height), oh = o.getScaledHeight();
                for (float t : new float[]{oy, oy + oh / 2f, oy + oh}) {
                    float d = Math.abs(e[0] - t);
                    if (d < bestDy) { bestDy = d; sy = t - e[1]; guideY = t; }
                }
            }
        }
        if (bestDx > SNAP) guideX = null;
        if (bestDy > SNAP) guideY = null;
        return new float[]{Math.max(0, Math.min(width - w, sx)), Math.max(0, Math.min(height - h, sy))};
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (panelClick(mx, my) || toolbarClick(mx, my)) return true;
        HudModule h = hoveredModule(mx, my);
        if (h == null) return false;
        if (button == 1) {
            Sounds.click();
            game().openScreen(ClickGuiScreen.forModule(this, h));
            return true;
        }
        if (button == 0) {
            dragging = h;
            dragOffX = (float) mx - h.getX(width);
            dragOffY = (float) my - h.getY(height);
        }
        return true;
    }

    @Override
    public boolean mouseReleased(double mx, double my, int button) {
        dragging = null;
        guideX = null;
        guideY = null;
        return true;
    }

    @Override
    public boolean mouseScrolled(double mx, double my, double vertical) {
        HudModule h = hoveredModule(mx, my);
        if (h != null) {
            float cx = h.getX(width) + h.getScaledWidth() / 2f, cy = h.getY(height) + h.getScaledHeight() / 2f;
            h.scale.set(h.scale.get() + (vertical > 0 ? 0.05 : -0.05));
            // keep the element centred on the same point while resizing
            h.setPosition(cx - h.getScaledWidth() / 2f, cy - h.getScaledHeight() / 2f, width, height);
            return true;
        }
        return false;
    }

    @Override
    public boolean keyPressed(int keyCode, int modifiers) {
        if (keyCode == Keys.ESCAPE) {
            close();
            return true;
        }
        return false;
    }

    @Override
    public void close() {
        open = false;
        NoreClient.get().config().save();
        game().openParent(parent);
    }
}
