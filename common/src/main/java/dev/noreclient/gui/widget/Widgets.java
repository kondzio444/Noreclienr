package dev.noreclient.gui.widget;

import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Motion;
import dev.noreclient.util.Theme;
import dev.noreclient.util.ThemeTokens;
import dev.noreclient.api.Gfx;

/** Shared drawing routines for themed controls. */
public final class Widgets {
    private Widgets() {}

    /** Album switch: a dot sticker on a slot track; {@code p} is the animated 0..1 on-state. */
    public static void toggle(Gfx ctx, float x, float y, float w, float h, float p) {
        Album.toggle(ctx, x, y, w, h, p);
    }

    /**
     * Highlighted surface tinted with {@code color} (selected item, accent field). Album has no glows:
     * it is a flat tone step towards the colour, a little stronger on hover.
     */
    public static void glowBox(Gfx ctx, float x, float y, float w, float h, float r, int color, float hover, float strength) {
        int face = ColorUtil.lerp(Theme.RAISED_2, ColorUtil.lerp(color, 0xFF000000, 0.25f), 0.45f + 0.25f * hover);
        Render2D.roundedRect(ctx, x, y, w, h, Math.min(r, ThemeTokens.RADIUS_STICKER), ColorUtil.withAlpha(face, (int) (255 * Math.max(0, Math.min(1, strength)))));
    }

    /** Text colour that sits on a {@link #glowBox}. */
    public static int glowText(int color, float hover) {
        return ColorUtil.lerp(Theme.TEXT, 0xFFFFFFFF, hover);
    }

    /** Pill button; {@code primary} is the accent sticker, otherwise a secondary (page-raised-2) pill. */
    public static void button(Gfx ctx, float x, float y, float w, float h, String label, float hover, boolean primary) {
        Album.button(ctx, x, y, w, h, label, primary ? Album.PRIMARY : Album.SECONDARY, hover);
    }

    public static final int NORMAL = 0, PRIMARY = 1, DANGER = 2;

    /**
     * Large menu row used by title-like screens: plain on the page, a white sticker with a peel corner
     * when hovered; PRIMARY is the violet pill, DANGER has soft red text. An optional hint fades in.
     */
    public static void menuButton(Gfx ctx, float x, float y, float w, float h, String label, String hint, float hov, int style) {
        if (style == NORMAL) {
            Render2D.roundedRect(ctx, x, y, w, h, ThemeTokens.RADIUS_STICKER, ColorUtil.withAlpha(Theme.page(), 0xD8));
        }
        Album.row(ctx, x, y, w, h, hov, style == PRIMARY ? 1 : style == DANGER ? 2 : 0, Theme.page());
        float ly = y - hov * ThemeTokens.LIFT_PX * Motion.travel();
        int tc = Album.rowInk(hov, style == PRIMARY ? 1 : style == DANGER ? 2 : 0);
        float cy = ly + (h - 8) / 2f;
        if (hint != null && hov > 0.02f) {
            Render2D.text(ctx, label, x + 10, cy, tc, false);
            int hc = ColorUtil.withAlpha(style == PRIMARY ? 0xFFFFFFFF : Theme.VINYL_INK_SOFT, (int) (230 * hov));
            Render2D.text(ctx, hint, x + w - 8 - Render2D.textWidth(hint), cy, hc, false);
        } else {
            Render2D.centeredText(ctx, label, x + w / 2f, cy, tc, false);
        }
    }

    /** Checkerboard used behind translucent colour previews. */
    public static void checker(Gfx ctx, float x, float y, float w, float h, int cell) {
        for (int i = 0; i * cell < w; i++) {
            for (int j = 0; j * cell < h; j++) {
                int c = ((i + j) & 1) == 0 ? 0xFFBBBBBB : 0xFF777777;
                Render2D.rect(ctx, x + i * cell, y + j * cell, Math.min(cell, w - i * cell), Math.min(cell, h - j * cell), c);
            }
        }
    }
}
