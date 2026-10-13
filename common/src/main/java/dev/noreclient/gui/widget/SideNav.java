package dev.noreclient.gui.widget;

import dev.noreclient.api.Gfx;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.List;

/** Vertical navigation list with icons used by the main and pause menus. */
public final class SideNav {
    public static final int PLAY = 0, GLOBE = 1, GRID = 2, HUD = 3, DOWNLOAD = 4, GEAR = 5, POWER = 6, STAR = 7, CHART = 8, WIFI = 9, BACK = 10;
    public static final int NORMAL = 0, PRIMARY = 1, DANGER = 2;

    private static final class Item {
        final String label, hint;
        final int icon, style;
        final Runnable action;
        final Animation hover = new Animation(0, 14);

        Item(String label, String hint, int icon, int style, Runnable action) {
            this.label = label;
            this.hint = hint;
            this.icon = icon;
            this.style = style;
            this.action = action;
        }
    }

    private final List<Item> items = new ArrayList<Item>();
    private float x, y, w, rowH;

    public void clear() { items.clear(); }

    public SideNav add(String label, String hint, int icon, int style, Runnable action) {
        items.add(new Item(label, hint, icon, style, action));
        return this;
    }

    public int size() { return items.size(); }

    /** Height of the list (the last item is separated by a small gap). */
    public float height(float rowH) { return items.size() * rowH + 8; }

    private float rowY(int i) { return y + i * rowH + (i == items.size() - 1 ? 8 : 0); }

    public static void icon(Gfx g, int which, float cx, float cy, float s, int color) {
        switch (which) {
            case PLAY: Icons.play(g, cx, cy, s, color); break;
            case GLOBE: Icons.globe(g, cx, cy, s, color); break;
            case GRID: Icons.grid(g, cx, cy, s * 0.9f, color); break;
            case HUD: Icons.hud(g, cx, cy, s * 0.9f, color); break;
            case DOWNLOAD: Icons.download(g, cx, cy, s, color); break;
            case GEAR: Icons.gear(g, cx, cy, s, color); break;
            case STAR: Icons.star(g, cx, cy, s * 0.6f, color, true); break;
            case CHART:
                for (int k = 0; k < 3; k++) Render2D.rect(g, cx - s * 0.45f + k * s * 0.33f, cy + s * 0.4f - s * (0.35f + k * 0.25f), s * 0.22f, s * (0.35f + k * 0.25f), color);
                break;
            case WIFI: Icons.globe(g, cx, cy, s, color); break;
            case BACK: Icons.play(g, cx + 0.5f, cy, s * 0.9f, color); break;
            default: Icons.power(g, cx, cy, s, color); break;
        }
    }

    /** Draws the list; {@code stage(i)} gives the 0..1 entrance progress of row i. */
    public void render(Gfx g, float x, float y, float w, float rowH, int mouseX, int mouseY, boolean interactive, float[] stages) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.rowH = rowH;
        for (int i = 0; i < items.size(); i++) {
            Item it = items.get(i);
            float p = stages == null || i >= stages.length ? 1 : stages[i];
            float ry = rowY(i);
            g.setAlpha(Math.max(0, p));
            float xo = (1 - p) * -18;
            boolean hov = interactive && p > 0.9f && Render2D.hovered(mouseX, mouseY, x, ry, w, rowH - 2);
            float h = it.hover.target(hov ? 1 : 0).update();
            int color = it.style == DANGER ? 0xFFFF5C5C : Theme.accent();
            float rx = x + xo, bh = rowH - 2, r = Theme.radius();
            if (it.style == PRIMARY) Widgets.glowBox(g, rx, ry, w, bh, r, color, h, 0.9f);
            else if (h > 0.01f) Widgets.glowBox(g, rx, ry, w, bh, r, color, h * 0.8f, h);
            if (h > 0.01f) Render2D.roundedRect(g, rx + 2, ry + bh / 2f - 4.5f * h, 2.5f, 9 * h, 1.25f, color);
            int tc = it.style == PRIMARY ? Widgets.glowText(color, h) : ColorUtil.lerp(it.style == DANGER ? 0xFFFFB0B0 : 0xFFE4D8CE, 0xFFFFFFFF, h);
            int ic = it.style == PRIMARY ? ColorUtil.lerp(color, 0xFFFFFFFF, 0.3f) : ColorUtil.lerp(Theme.TEXT_MUTED, color, Math.max(h, 0.15f));
            icon(g, it.icon, rx + 15 + h * 2, ry + bh / 2f, 8, ic);
            Render2D.text(g, it.label, rx + 27 + h * 3, ry + bh / 2f - 3.5f, tc, false);
            if (it.hint != null && h > 0.05f) {
                Render2D.scaledText(g, it.hint, rx + w - 8 - Render2D.textWidth(it.hint) * 0.7f + (1 - h) * 6, ry + bh / 2f - 2,
                        0.7f, ColorUtil.withAlpha(ColorUtil.brighten(color, 0.4f), (int) (200 * h)), false);
            }
        }
        g.setAlpha(1);
    }

    /** Returns true when a row was clicked (its action has run). */
    public boolean click(double mx, double my) {
        for (int i = 0; i < items.size(); i++) {
            if (Render2D.hovered(mx, my, x, rowY(i), w, rowH - 2)) {
                Item it = items.get(i);
                if (it.action != null) it.action.run();
                return true;
            }
        }
        return false;
    }
}
