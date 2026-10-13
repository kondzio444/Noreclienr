package dev.noreclient.gui.widget;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.Category;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;

/** Small vector icons drawn from primitives (no textures), centred on (cx, cy). */
public final class Icons {
    private Icons() {}

    public static void category(Gfx g, Category c, float cx, float cy, float s, int color) {
        if (c == null) { grid(g, cx, cy, s, color); return; }
        switch (c) {
            case HUD: hud(g, cx, cy, s, color); break;
            case RENDER: eye(g, cx, cy, s, color); break;
            case PLAYER: person(g, cx, cy, s, color); break;
            case UTILITY: wrench(g, cx, cy, s, color); break;
            default: sliders(g, cx, cy, s, color); break;
        }
    }

    /** Rounded tile with a tinted gradient and the category icon. */
    public static void tile(Gfx g, Category c, float x, float y, float size, float glow) {
        int col = c == null ? 0xFFFFFFFF : c.color;
        float r = size * 0.28f;
        if (glow > 0.01f) Render2D.shadow(g, x, y, size, size, r, 4, ColorUtil.withAlpha(col, (int) (90 * glow)));
        Render2D.roundedGradient(g, x, y, size, size, r, ColorUtil.withAlpha(col, 70), ColorUtil.withAlpha(col, 26), true);
        Render2D.roundedOutline(g, x, y, size, size, r, 1, ColorUtil.withAlpha(col, 120));
        category(g, c, x + size / 2f, y + size / 2f, size * 0.5f, ColorUtil.brighten(col, 0.35f));
    }

    public static void grid(Gfx g, float cx, float cy, float s, int color) {
        float q = s * 0.42f, gap = s * 0.16f;
        for (int i = 0; i < 4; i++) {
            float x = cx - q - gap / 2 + (i % 2) * (q + gap), y = cy - q - gap / 2 + (i / 2) * (q + gap);
            Render2D.roundedRect(g, x, y, q, q, q * 0.3f, color);
        }
    }

    public static void hud(Gfx g, float cx, float cy, float s, int color) {
        float w = s * 1.1f, h = s * 0.8f;
        Render2D.roundedOutline(g, cx - w / 2, cy - h / 2, w, h, s * 0.15f, 1.1f, color);
        Render2D.roundedRect(g, cx - w / 2 + 2, cy - h / 2 + 2, w * 0.35f, h * 0.3f, 1, color);
        Render2D.rect(g, cx - w / 2 + 2, cy + h / 2 - 3.5f, w - 4, 1.1f, ColorUtil.fade(color, 0.7f));
    }

    public static void eye(Gfx g, float cx, float cy, float s, int color) {
        Render2D.ring(g, cx, cy, s * 0.55f, 1.1f, 0, 360, color);
        Render2D.circle(g, cx, cy, s * 0.22f, color);
    }

    public static void person(Gfx g, float cx, float cy, float s, int color) {
        Render2D.circle(g, cx, cy - s * 0.25f, s * 0.24f, color);
        Render2D.roundedRect(g, cx - s * 0.4f, cy + s * 0.08f, s * 0.8f, s * 0.42f, s * 0.2f, color);
    }

    public static void wrench(Gfx g, float cx, float cy, float s, int color) {
        Render2D.line(g, cx - s * 0.4f, cy + s * 0.4f, cx + s * 0.15f, cy - s * 0.15f, 1.6f, color);
        Render2D.ring(g, cx + s * 0.25f, cy - s * 0.25f, s * 0.25f, 1.2f, 0, 270, color);
    }

    public static void sliders(Gfx g, float cx, float cy, float s, int color) {
        for (int k = 0; k < 3; k++) {
            float y = cy - s * 0.35f + k * s * 0.35f;
            Render2D.rect(g, cx - s * 0.5f, y - 0.5f, s, 1.1f, ColorUtil.fade(color, 0.7f));
            float kx = cx + (k == 1 ? -s * 0.2f : s * 0.22f);
            Render2D.circle(g, kx, y, s * 0.14f, color);
        }
    }

    /** Five-point star, filled or outlined. */
    public static void star(Gfx g, float cx, float cy, float r, int color, boolean filled) {
        int n = 10;
        float[] xy = new float[(n + 2) * 2];
        int[] cols = new int[n + 2];
        xy[0] = cx;
        xy[1] = cy;
        cols[0] = color;
        for (int i = 0; i <= n; i++) {
            double a = -Math.PI / 2 + i * Math.PI / 5;
            float rr = i % 2 == 0 ? r : r * 0.45f;
            xy[(i + 1) * 2] = cx + (float) Math.cos(a) * rr;
            xy[(i + 1) * 2 + 1] = cy + (float) Math.sin(a) * rr;
            cols[i + 1] = color;
        }
        if (filled) {
            g.mesh(Gfx.TRIANGLE_FAN, xy, cols, n + 2);
        } else {
            for (int i = 1; i <= n; i++) {
                Render2D.line(g, xy[i * 2], xy[i * 2 + 1], xy[(i + 1) * 2], xy[(i + 1) * 2 + 1], 1f, color);
            }
        }
    }

    /** Four-point sparkle used for "new". */
    public static void sparkle(Gfx g, float cx, float cy, float r, int color) {
        float[] xy = {cx, cy, cx, cy - r, cx + r * 0.25f, cy - r * 0.25f, cx + r, cy, cx + r * 0.25f, cy + r * 0.25f,
                cx, cy + r, cx - r * 0.25f, cy + r * 0.25f, cx - r, cy, cx - r * 0.25f, cy - r * 0.25f, cx, cy - r};
        int[] cols = new int[10];
        for (int i = 0; i < cols.length; i++) cols[i] = color;
        g.mesh(Gfx.TRIANGLE_FAN, xy, cols, 10);
    }

    public static void play(Gfx g, float cx, float cy, float s, int color) {
        float[] xy = {cx - s * 0.32f, cy - s * 0.42f, cx - s * 0.32f, cy + s * 0.42f, cx + s * 0.42f, cy};
        g.mesh(Gfx.TRIANGLES, xy, new int[]{color, color, color}, 3);
    }

    public static void globe(Gfx g, float cx, float cy, float s, int color) {
        float r = s * 0.48f;
        Render2D.ring(g, cx, cy, r, 1.1f, 0, 360, color);
        Render2D.rect(g, cx - r, cy - 0.55f, r * 2, 1.1f, color);
        Render2D.rect(g, cx - 0.55f, cy - r, 1.1f, r * 2, color);
    }

    public static void power(Gfx g, float cx, float cy, float s, int color) {
        Render2D.ring(g, cx, cy + s * 0.05f, s * 0.42f, 1.2f, -50, 230, color);
        Render2D.rect(g, cx - 0.6f, cy - s * 0.5f, 1.2f, s * 0.45f, color);
    }

    public static void gear(Gfx g, float cx, float cy, float s, int color) {
        for (int i = 0; i < 8; i++) {
            double a = Math.PI * 2 * i / 8;
            Render2D.line(g, cx + (float) Math.cos(a) * s * 0.28f, cy + (float) Math.sin(a) * s * 0.28f,
                    cx + (float) Math.cos(a) * s * 0.5f, cy + (float) Math.sin(a) * s * 0.5f, 1.6f, color);
        }
        Render2D.ring(g, cx, cy, s * 0.34f, 1.3f, 0, 360, color);
    }

    public static void camera(Gfx g, float cx, float cy, float s, int color) {
        Render2D.roundedOutline(g, cx - s * 0.5f, cy - s * 0.28f, s, s * 0.68f, s * 0.12f, 1.1f, color);
        Render2D.rect(g, cx - s * 0.18f, cy - s * 0.42f, s * 0.36f, s * 0.16f, color);
        Render2D.ring(g, cx, cy + s * 0.06f, s * 0.2f, 1.1f, 0, 360, color);
    }

    public static void download(Gfx g, float cx, float cy, float s, int color) {
        Render2D.rect(g, cx - 0.6f, cy - s * 0.5f, 1.2f, s * 0.65f, color);
        Render2D.line(g, cx - s * 0.32f, cy, cx, cy + s * 0.3f, 1.2f, color);
        Render2D.line(g, cx + s * 0.32f, cy, cx, cy + s * 0.3f, 1.2f, color);
        Render2D.rect(g, cx - s * 0.45f, cy + s * 0.45f, s * 0.9f, 1.2f, color);
    }
}
