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
        int off = 0xFF2E2621;
        if (p > 0.02f) Render2D.shadow(ctx, x, y, w, h, h / 2f, 4, ColorUtil.withAlpha(Theme.accent(), (int) (110 * p)));
        int bg = ColorUtil.lerp(off, ColorUtil.darken(Theme.accent(), 0.15f), p);
        Render2D.roundedRect(ctx, x, y, w, h, h / 2f, bg);
        Render2D.roundedOutline(ctx, x, y, w, h, h / 2f, 1, ColorUtil.lerp(0x20FFFFFF, ColorUtil.brighten(Theme.accent(), 0.3f), p));
        float knob = h - 4;
        float kx = x + 2 + (w - knob - 4) * p;
        Render2D.circle(ctx, kx + knob / 2f, y + h / 2f, knob / 2f, 0xFFFFFFFF);
    }

    /**
     * The signature "glow" surface: translucent tinted fill, bright outline and a soft outer glow
     * that intensifies on hover (the style of the "Wyjdź" button, used everywhere).
     */
    public static void glowBox(DrawContext ctx, float x, float y, float w, float h, float r, int color, float hover, float strength) {
        int glow = (int) ((55 + 75 * hover) * strength);
        Render2D.shadow(ctx, x, y, w, h, r, (int) (5 + 4 * hover), ColorUtil.withAlpha(color, Math.min(255, glow)));
        Render2D.roundedRect(ctx, x, y, w, h, r, 0xD0120E0B);
        Render2D.roundedGradient(ctx, x, y, w, h, r,
                ColorUtil.withAlpha(color, (int) (46 + 34 * hover)), ColorUtil.withAlpha(color, (int) (22 + 26 * hover)), true);
        Render2D.roundedOutline(ctx, x, y, w, h, r, 1, ColorUtil.withAlpha(ColorUtil.brighten(color, 0.15f * hover), (int) (190 + 65 * hover)));
    }

    /** Text colour that sits on a glow surface. */
    public static int glowText(int color, float hover) {
        return ColorUtil.lerp(ColorUtil.brighten(color, 0.62f), 0xFFFFFFFF, hover);
    }

    /** Button with hover animation; {@code primary} uses the glowing accent style. */
    public static void button(DrawContext ctx, float x, float y, float w, float h, String label, float hover, boolean primary) {
        float r = Theme.radius();
        if (primary) {
            glowBox(ctx, x, y, w, h, r, Theme.accent(), hover, 1f);
            Render2D.centeredText(ctx, label, x + w / 2f, y + (h - 8) / 2f, glowText(Theme.accent(), hover), false);
        } else {
            if (hover > 0.01f) {
                glowBox(ctx, x, y, w, h, r, Theme.accent(), hover * 0.8f, hover);
            } else {
                Render2D.roundedRect(ctx, x, y, w, h, r, Theme.CARD);
                Render2D.roundedOutline(ctx, x, y, w, h, r, 1, Theme.OUTLINE);
            }
            Render2D.centeredText(ctx, label, x + w / 2f, y + (h - 8) / 2f, ColorUtil.lerp(Theme.TEXT_DIM, 0xFFFFFFFF, hover), false);
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
        int color = style == DANGER ? 0xFFFF5C5C : Theme.accent();
        if (style == NORMAL) {
            Render2D.roundedRect(ctx, x, y, w, h, r, 0xB0120E0B);
            Render2D.roundedOutline(ctx, x, y, w, h, r, 1, 0x26FFFFFF);
            if (hov > 0.01f) glowBox(ctx, x, y, w, h, r, color, hov * 0.85f, hov);
        } else {
            glowBox(ctx, x, y, w, h, r, color, hov, 1f);
        }
        if (style == PRIMARY) {
            // slow light sweep across the primary button
            float sweep = (float) ((System.currentTimeMillis() % 3600) / 3600.0);
            float sx = x + 4 + (w - 32) * sweep;
            Render2D.quadGradient(ctx, sx, y + 1, 12, h - 2, 0x00FFFFFF, 0x18FFFFFF, 0x18FFFFFF, 0x00FFFFFF);
            Render2D.quadGradient(ctx, sx + 12, y + 1, 12, h - 2, 0x18FFFFFF, 0x00FFFFFF, 0x00FFFFFF, 0x18FFFFFF);
        }
        float cy = y + (h - 8) / 2f;
        int tc = style == NORMAL ? ColorUtil.lerp(0xFFE2D6CC, 0xFFFFFFFF, hov) : glowText(color, hov);
        boolean shadow = false;
        if (style == NORMAL && hov > 0.01f) Render2D.roundedRect(ctx, x + 4, y + h / 2f - 5 * hov, 2.5f, 10 * hov, 1.25f, color);
        if (hint != null && hov > 0.02f) {
            float base = x + w / 2f - Render2D.textWidth(label) / 2f;
            Render2D.text(ctx, label, base + (x + 14 - base) * hov, cy, tc, shadow);
            int hc = ColorUtil.withAlpha(ColorUtil.brighten(color, 0.5f), (int) (200 * hov));
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
