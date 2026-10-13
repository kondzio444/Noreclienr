package dev.noreclient.gui.widget;

import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import net.minecraft.client.gui.DrawContext;

/** Shared drawing routines for themed controls. */
public final class Widgets {
    private Widgets() {}

    /** iOS-like switch; {@code p} is the animated 0..1 on-state. */
    public static void toggle(DrawContext ctx, float x, float y, float w, float h, float p) {
        int off = 0xFF2C3044;
        int bg = ColorUtil.lerp(off, Theme.accent(), p);
        Render2D.roundedRect(ctx, x, y, w, h, h / 2f, bg);
        float knob = h - 4;
        float kx = x + 2 + (w - knob - 4) * p;
        Render2D.circle(ctx, kx + knob / 2f, y + h / 2f, knob / 2f, 0xFFFFFFFF);
    }

    /** Button with hover animation; {@code primary} uses the accent gradient. */
    public static void button(DrawContext ctx, float x, float y, float w, float h, String label, float hover, boolean primary) {
        float r = Theme.radius();
        if (primary) {
            int c1 = ColorUtil.brighten(Theme.accent(), hover * 0.15f);
            int c2 = ColorUtil.brighten(Theme.accent2(), hover * 0.15f);
            if (hover > 0.01f) Render2D.shadow(ctx, x, y, w, h, r, 5, ColorUtil.withAlpha(Theme.accent(), (int) (90 * hover)));
            Render2D.roundedGradient(ctx, x, y, w, h, r, c1, c2, false);
            Render2D.centeredText(ctx, label, x + w / 2f, y + (h - 8) / 2f, 0xFFFFFFFF, true);
        } else {
            Render2D.roundedRect(ctx, x, y, w, h, r, ColorUtil.lerp(Theme.CARD, Theme.CARD_HOVER, hover));
            Render2D.roundedOutline(ctx, x, y, w, h, r, 1, ColorUtil.lerp(Theme.OUTLINE, ColorUtil.withAlpha(Theme.accent(), 180), hover));
            Render2D.centeredText(ctx, label, x + w / 2f, y + (h - 8) / 2f, ColorUtil.lerp(Theme.TEXT_DIM, Theme.TEXT, hover), false);
        }
    }

    public static final int NORMAL = 0, PRIMARY = 1, DANGER = 2;

    /**
     * Large menu button used by the title and pause screens: lifts and glows on hover, an accent
     * bar slides in, the label slides aside and an optional hint fades in.
     */
    public static void menuButton(DrawContext ctx, float x, float y, float w, float h, String label, String hint, float hov, int style) {
        float r = Theme.radius();
        y -= hov * 1.5f;
        int glow = style == DANGER ? 0xFFF87171 : Theme.accent();
        if (hov > 0.01f) Render2D.shadow(ctx, x, y, w, h, r, 6, ColorUtil.withAlpha(glow, (int) (80 * hov)));
        if (style == PRIMARY) {
            Render2D.roundedGradient(ctx, x, y, w, h, r,
                    ColorUtil.brighten(Theme.accent(), hov * 0.12f), ColorUtil.brighten(Theme.accent2(), hov * 0.12f), false);
            float sweep = (float) ((System.currentTimeMillis() % 3200) / 3200.0);
            float sx = x + 4 + (w - 32) * sweep;
            Render2D.quadGradient(ctx, sx, y + 1, 12, h - 2, 0x00FFFFFF, 0x28FFFFFF, 0x28FFFFFF, 0x00FFFFFF);
            Render2D.quadGradient(ctx, sx + 12, y + 1, 12, h - 2, 0x28FFFFFF, 0x00FFFFFF, 0x00FFFFFF, 0x28FFFFFF);
        } else if (style == DANGER) {
            Render2D.roundedRect(ctx, x, y, w, h, r, ColorUtil.lerp(0x90301018, 0xD0C0384C, hov));
            Render2D.roundedOutline(ctx, x, y, w, h, r, 1, ColorUtil.lerp(0x50F87171, 0xFFF87171, hov));
        } else {
            Render2D.roundedRect(ctx, x, y, w, h, r, ColorUtil.lerp(0xB0141522, 0xE0202334, hov));
            Render2D.roundedOutline(ctx, x, y, w, h, r, 1, ColorUtil.lerp(0x30FFFFFF, ColorUtil.withAlpha(Theme.accent(), 220), hov));
            if (hov > 0.01f) Render2D.roundedRect(ctx, x + 4, y + h / 2f - 5 * hov, 2.5f, 10 * hov, 1.25f, Theme.accent());
        }
        float cy = y + (h - 8) / 2f;
        int tc = style == PRIMARY ? 0xFFFFFFFF : style == DANGER ? ColorUtil.lerp(Theme.ERROR, 0xFFFFFFFF, hov)
                : ColorUtil.lerp(0xFFD0D3E2, 0xFFFFFFFF, hov);
        boolean shadow = style == PRIMARY;
        if (hint != null && hov > 0.02f) {
            float base = x + w / 2f - Render2D.textWidth(label) / 2f;
            Render2D.text(ctx, label, base + (x + 14 - base) * hov, cy, tc, shadow);
            int hc = ColorUtil.withAlpha(style == PRIMARY ? 0xFFFFFFFF : Theme.TEXT_DIM, (int) (200 * hov));
            Render2D.scaledText(ctx, hint, x + w - 10 - Render2D.textWidth(hint) * 0.75f + (1 - hov) * 8, cy + 1.5f, 0.75f, hc, false);
        } else {
            Render2D.centeredText(ctx, label, x + w / 2f + hov * 2, cy, tc, shadow);
        }
    }

    /** Checkerboard used behind translucent colour previews. */
    public static void checker(DrawContext ctx, float x, float y, float w, float h, int cell) {
        for (int i = 0; i * cell < w; i++) {
            for (int j = 0; j * cell < h; j++) {
                int c = ((i + j) & 1) == 0 ? 0xFFBBBBBB : 0xFF777777;
                Render2D.rect(ctx, x + i * cell, y + j * cell, Math.min(cell, w - i * cell), Math.min(cell, h - j * cell), c);
            }
        }
    }
}
