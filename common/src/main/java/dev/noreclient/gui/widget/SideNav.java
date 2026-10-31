package dev.noreclient.gui.widget;

import dev.noreclient.api.Gfx;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Motion;
import dev.noreclient.util.Theme;
import dev.noreclient.util.ThemeTokens;

import java.util.ArrayList;
import java.util.List;

/** Vertical navigation list with icons used by the main and pause menus. */
public final class SideNav {
    public static final int PLAY = 0, GLOBE = 1, GRID = 2, HUD = 3, DOWNLOAD = 4, GEAR = 5, POWER = 6, STAR = 7, CHART = 8, WIFI = 9, BACK = 10, CAMERA = 11, PERSON = 12, SHOP = 13, HELP = 14, MODS = 15;
    public static final int NORMAL = 0, PRIMARY = 1, DANGER = 2;

    private static final class Item {
        final String label, hint;
        String key;
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

    /** Shows a keycap (e.g. "P.Shift") at the end of the last added row. */
    public SideNav key(String k) {
        if (!items.isEmpty()) items.get(items.size() - 1).key = k;
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
            case CAMERA: Icons.camera(g, cx, cy, s, color); break;
            case PERSON: Icons.person(g, cx, cy, s, color); break;
            case SHOP: Icons.bag(g, cx, cy, s, color); break;
            case HELP: Icons.question(g, cx, cy, s, color); break;
            case MODS: Icons.wrench(g, cx, cy, s, color); break;
            default: Icons.power(g, cx, cy, s, color); break;
        }
    }

    /** Draws the list; {@code stage(i)} gives the 0..1 entrance progress of row i. */
    public void render(Gfx g, float x, float y, float w, float rowH, int mouseX, int mouseY, boolean interactive, float[] stages) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.rowH = rowH;
        int under = Theme.page();
        float base = g.getAlpha();
        for (int i = 0; i < items.size(); i++) {
            Item it = items.get(i);
            float p = stages == null || i >= stages.length ? 1 : stages[i];
            float ry = rowY(i);
            g.setAlpha(base * Math.max(0, Math.min(1, p * 1.4f)));
            float xo = (1 - p) * -8 * Motion.travel();
            boolean hov = interactive && p > 0.9f && Render2D.hovered(mouseX, mouseY, x, ry, w, rowH - 2);
            float h = it.hover.target(hov ? 1 : 0).update();
            int style = it.style == PRIMARY ? 1 : it.style == DANGER ? 2 : 0;
            float rx = x + xo, bh = rowH - 3;
            Album.row(g, rx, ry, w, bh, h, style, under);
            float ly = ry - (style == 1 || h > 0.02f ? h * ThemeTokens.LIFT_PX * Motion.travel() : 0);
            int tc = Album.rowInk(h, style);
            int ic = Album.rowIcon(h, style);
            icon(g, it.icon, rx + 11, ly + bh / 2f, 8, ic);
            Render2D.text(g, it.label, rx + 21, ly + (bh - 8) / 2f + 0.5f, tc, false);
            if (it.key != null) {
                float kw = Album.keycapWidth(it.key);
                if (h > 0.3f) Album.keycapLight(g, it.key, rx + w - 6 - kw + 2, ly + (bh - 10) / 2f);
                else Album.keycap(g, it.key, rx + w - 6 - kw, ly + (bh - 10) / 2f);
            } else if (it.hint != null && h > 0.05f && style != 1) {
                int hc = ColorUtil.withAlpha(style == 2 ? 0xFFB3261E : Theme.VINYL_INK_SOFT, (int) (230 * Math.min(1, h * 1.4f)));
                float hw = Render2D.textWidth(it.hint);
                if (Render2D.textWidth(it.label) + hw + 34 < w) Render2D.text(g, it.hint, rx + w - 8 - hw, ly + (bh - 8) / 2f + 0.5f, hc, false);
            }
        }
        g.setAlpha(base);
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
