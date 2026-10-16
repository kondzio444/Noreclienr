package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.widget.TextBox;
import dev.noreclient.gui.widget.Widgets;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.MenuBackground;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Base for full-screen Nore pages: background, header with back button, buttons, panels and click areas. */
public abstract class PanelScreen extends NoreScreen {
    protected final long opened = System.currentTimeMillis();
    private final Map<String, Animation> anims = new HashMap<String, Animation>();
    private final List<float[]> hitRects = new ArrayList<float[]>();
    private final List<Runnable> hitActions = new ArrayList<Runnable>();
    protected final Animation scroll = new Animation(0, 14);
    protected float scrollTarget, contentH, viewH;
    protected final List<TextBox> boxes = new ArrayList<TextBox>();

    protected PanelScreen(Object parent) {
        super(parent);
    }

    @Override
    public Background background() { return game().inWorld() ? Background.DIM_WORLD : Background.NONE; }

    protected Animation anim(String k) {
        Animation a = anims.get(k);
        if (a == null) anims.put(k, a = new Animation(0, 16));
        return a;
    }

    protected void hit(float x, float y, float w, float h, Runnable r) {
        hitRects.add(new float[]{x, y, w, h});
        hitActions.add(r);
    }

    protected float intro(long delay) {
        return Animation.easeOutCubic((System.currentTimeMillis() - opened - delay) / 400f);
    }

    protected abstract String title();

    protected abstract String subtitle();

    protected abstract void content(Gfx g, int mx, int my, float x, float y, float w, float h);

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        CurrentGfx.set(g);
        hitRects.clear();
        hitActions.clear();
        if (!game().inWorld()) MenuBackground.render(g, width, height, mx, my);
        Render2D.rect(g, 0, 0, width, height, 0x800A0614);
        float in = intro(0);
        g.setAlpha(in);
        float pad = 14;
        boolean bh = Render2D.hovered(mx, my, pad, 12, 20, 20);
        float ba = anim("back").target(bh ? 1 : 0).update();
        Render2D.circle(g, pad + 10, 22, 10, ColorUtil.withAlpha(Theme.accent(), (int) (40 + 60 * ba)));
        Render2D.line(g, pad + 12, 17, pad + 7, 22, 1.6f, 0xFFFFFFFF);
        Render2D.line(g, pad + 7, 22, pad + 12, 27, 1.6f, 0xFFFFFFFF);
        hit(pad, 12, 20, 20, this::close);
        Render2D.gradientText(g, title(), pad + 28, 13, 1.5f, Theme.accent2(), Theme.accent(), true);
        Render2D.scaledText(g, subtitle(), pad + 28, 28, 0.7f, Theme.TEXT_MUTED, false);
        headerButtons(g, mx, my, width - pad, 14);
        content(g, mx, my, pad, 44 + (1 - in) * 8, width - pad * 2, height - 54);
        g.setAlpha(1);
    }

    /** Buttons right-aligned in the header, drawn right to left from x. */
    protected void headerButtons(Gfx g, int mx, int my, float right, float y) {}

    protected float button(Gfx g, int mx, int my, float x, float y, String label, int style, boolean active, Runnable action) {
        float w = Render2D.textWidth(label) + 18, h = 18;
        boolean hov = active && Render2D.hovered(mx, my, x, y, w, h);
        int col = style == 2 ? 0xFFFF5C5C : style == 3 ? Theme.SUCCESS : Theme.accent();
        Widgets.glowBox(g, x, y, w, h, Theme.radius(), col, anim("b" + label + x).target(hov ? 1 : 0).update(), active ? (style == 1 ? 1f : 0.55f) : 0.25f);
        Render2D.centeredText(g, label, x + w / 2f, y + 5, active ? Widgets.glowText(col, 0.3f) : Theme.TEXT_MUTED, false);
        if (active) hit(x, y, w, h, () -> { Sounds.click(); action.run(); });
        return w;
    }

    protected static float buttonWidth(String label) { return Render2D.textWidth(label) + 18; }

    protected void panel(Gfx g, float x, float y, float w, float h, String title) {
        float r = Theme.radius();
        Render2D.shadow(g, x, y, w, h, r, 6, 0x70000000);
        Render2D.roundedRect(g, x, y, w, h, r, 0xC8120E0B);
        Render2D.roundedOutline(g, x, y, w, h, r, 1, 0x26FFFFFF);
        Render2D.quadGradient(g, x + 8, y, w - 16, 1, 0, ColorUtil.withAlpha(Theme.accent(), 150), ColorUtil.withAlpha(Theme.accent(), 150), 0);
        if (title != null) Render2D.text(g, title, x + 7, y + 5, Theme.TEXT, false);
    }

    protected void box(TextBox b, Gfx g, float x, float y, float w, float h, String icon) {
        if (!boxes.contains(b)) boxes.add(b);
        b.render(g, x, y, w, h, icon);
        hit(x, y, w, h, () -> { for (TextBox o : boxes) o.setFocused(o == b); });
    }

    protected float scrolled() {
        scrollTarget = Math.max(0, Math.min(scrollTarget, contentH - viewH));
        return scroll.target(scrollTarget).update();
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (button != 0) return false;
        for (int i = hitRects.size() - 1; i >= 0; i--) {
            float[] r = hitRects.get(i);
            if (Render2D.hovered(mx, my, r[0], r[1], r[2], r[3])) {
                hitActions.get(i).run();
                return true;
            }
        }
        for (TextBox b : boxes) b.setFocused(false);
        return false;
    }

    @Override
    public boolean mouseScrolled(double mx, double my, double amount) {
        scrollTarget = (float) Math.max(0, Math.min(contentH - viewH, scrollTarget - amount * 30));
        return true;
    }

    @Override
    public boolean charTyped(char c) {
        for (TextBox b : boxes) if (b.charTyped(c)) return true;
        return false;
    }

    @Override
    public boolean keyPressed(int key, int modifiers) {
        for (TextBox b : boxes) {
            if (b.isFocused()) {
                if (key == dev.noreclient.api.Keys.ESCAPE) { b.setFocused(false); return true; }
                if (onEnter(b, key)) return true;
                if (b.keyPressed(key)) return true;
            }
        }
        return super.keyPressed(key, modifiers);
    }

    /** Enter in a text box; return true when handled. */
    protected boolean onEnter(TextBox box, int key) { return false; }
}
