package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.widget.TextBox;
import dev.noreclient.gui.widget.Album;
import dev.noreclient.util.Motion;
import dev.noreclient.util.ThemeTokens;
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

    /** Entrance progress (dur.page, ease.out) after {@code delay} ms; respects the "Animacje" setting. */
    protected float intro(long delay) {
        return Motion.progress(opened, delay, ThemeTokens.DUR_PAGE, ThemeTokens.EASE_OUT);
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
        Render2D.rect(g, 0, 0, width, height, ColorUtil.withAlpha(Theme.page(), 0x9C));
        float in = intro(0);
        g.setAlpha(in);
        float pad = 14;
        boolean bh = Render2D.hovered(mx, my, pad, 12, 20, 20);
        float ba = anim("back").target(bh ? 1 : 0).update();
        // back: a white sticker pill when hovered, a raised pill otherwise
        if (ba > 0.02f) Album.sticker(g, pad, 12, 20, 20, 10, Theme.VINYL, ba);
        else Render2D.roundedRect(g, pad, 12, 20, 20, 10, Theme.RAISED_2);
        int bc = ColorUtil.lerp(Theme.TEXT, Theme.VINYL_INK, ba);
        float by = 12 - ba * Motion.travel();
        Render2D.line(g, pad + 12, by + 5, pad + 7, by + 10, 1.6f, bc);
        Render2D.line(g, pad + 7, by + 10, pad + 12, by + 15, 1.6f, bc);
        hit(pad, 12, 20, 20, this::close);
        Album.titleShadow(g, sentence(title()), pad + 28, 11, Theme.TEXT);
        Render2D.text(g, Render2D.trim(subtitle(), width - 220), pad + 28, 30, Theme.TEXT_DIM, true);
        if (dev.noreclient.util.Events.any()) Album.eventDot(g, pad + 32 + Render2D.textWidth(sentence(title())) * 2 + 2, 15);
        headerButtons(g, mx, my, width - pad, 14);
        content(g, mx, my, pad, 44 + (1 - in) * 6 * Motion.travel(), width - pad * 2, height - 54);
        g.setAlpha(1);
    }

    /** Album titles are sentence case: "SZATNIA" becomes "Szatnia". */
    protected static String sentence(String t) {
        if (t == null || t.length() < 2 || !t.equals(t.toUpperCase(java.util.Locale.ROOT))) return t;
        return t.charAt(0) + t.substring(1).toLowerCase(new java.util.Locale("pl", "PL"));
    }

    /** Buttons right-aligned in the header, drawn right to left from x. */
    protected void headerButtons(Gfx g, int mx, int my, float right, float y) {}

    protected float button(Gfx g, int mx, int my, float x, float y, String label, int style, boolean active, Runnable action) {
        float w = Render2D.textWidth(label) + 18, h = 18;
        boolean hov = active && Render2D.hovered(mx, my, x, y, w, h);
        // 0 secondary, 1 primary (the violet hero), 2 danger, 3 confirm (white sticker)
        int st = style == 1 ? Album.PRIMARY : style == 2 ? Album.DANGER : style == 3 ? Album.WHITE : Album.SECONDARY;
        Album.button(g, x, y, w, h, label, st, anim("b" + label + x).target(hov ? 1 : 0).update(), active);
        if (active) hit(x, y, w, h, () -> { Sounds.click(); action.run(); });
        return w;
    }

    protected static float buttonWidth(String label) { return Render2D.textWidth(label) + 18; }

    protected void panel(Gfx g, float x, float y, float w, float h, String title) {
        Album.sheet(g, x, y, w, h);
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
