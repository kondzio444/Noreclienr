package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Motion;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.ThemeTokens;

/** Christmas event decorations for the Nore menus: drifting snow and a twinkling garland. Forced on from 10 December 2026. */
final class ChristmasDecor {
    /** 2026-12-10 00:00 local time – the winter event starts here and cannot be switched off. */
    private static final long START;

    static {
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.clear();
        c.set(2026, java.util.Calendar.DECEMBER, 10, 0, 0, 0);
        START = c.getTimeInMillis();
    }

    static boolean active() { return dev.noreclient.util.Events.winter(); }

    private static final int FLAKES = 90;
    private static final float[][] SNOW = new float[FLAKES][4];

    static {
        java.util.Random r = new java.util.Random(25);
        for (float[] f : SNOW) { f[0] = r.nextFloat(); f[1] = r.nextFloat(); f[2] = 0.35f + r.nextFloat() * 0.65f; f[3] = r.nextFloat() * 6.28f; }
    }

    private ChristmasDecor() {}

    /**
     * Album winter snow: hole-punch confetti (paper circles from the album's own puncher) falling slowly,
     * at most 60 flakes, scaled by the event intensity.
     */
    static void snow(Gfx g, float w, float h, float intensity) {
        double t = System.currentTimeMillis() / 1000.0;
        int count = Math.max(12, (int) (60 * intensity));
        for (int i = 0; i < count; i++) {
            float[] f = SNOW[i];
            float depth = f[2];
            float y = (float) ((f[1] + t * 0.03 * depth) % 1.0) * (h + 10) - 5;
            float x = (float) ((f[0] + Math.sin(t * 0.5 + f[3]) * 0.01 + t * 0.003 * depth) % 1.0) * w;
            float r = 0.9f + depth * 1.4f;
            int a = (int) (110 + 130 * depth);
            Render2D.circle(g, x, y + 0.6f, r, ColorUtil.withAlpha(0xFF000000, a / 4));
            Render2D.circle(g, x, y, r, ColorUtil.withAlpha(ThemeTokens.WINTER_FROST, a));
        }
    }

    /** Frost creeping from the four page corners (static). */
    static void frost(Gfx g, float w, float h, float intensity) {
        int c = ColorUtil.withAlpha(ThemeTokens.WINTER_FROST, (int) (70 * intensity));
        float r = Math.min(w, h) * 0.32f;
        Render2D.radial(g, 0, 0, r, c, 0x00E9F4FF);
        Render2D.radial(g, w, 0, r, c, 0x00E9F4FF);
        Render2D.radial(g, 0, h, r * 0.8f, c, 0x00E9F4FF);
        Render2D.radial(g, w, h, r * 0.8f, c, 0x00E9F4FF);
    }

    private static final int[] LIGHTS = {ThemeTokens.WINTER_LIGHT_RED, ThemeTokens.WINTER_LIGHT_GREEN, ThemeTokens.WINTER_LIGHT_GOLD, ThemeTokens.WINTER_LIGHT_BLUE};

    /** A string of light dot stickers from x0 to x1 that twinkle in steps. */
    static void lights(Gfx g, float x0, float x1, float y) {
        long step = Motion.ambient() ? System.currentTimeMillis() / 600 : 0;
        int n = Math.max(2, (int) ((x1 - x0) / 12));
        Render2D.line(g, x0, y, x1, y, 0.8f, 0xFF2A3A2C);
        for (int i = 0; i < n; i++) {
            float x = x0 + (x1 - x0) * i / (n - 1f);
            boolean on = ((i + step) % 3) != 0;
            int c = LIGHTS[i % LIGHTS.length];
            Render2D.circle(g, x, y + 2, 2.2f, ThemeTokens.VINYL);
            Render2D.circle(g, x, y + 2, 1.4f, on ? c : ColorUtil.lerp(c, 0xFF141216, 0.6f));
        }
    }

    /** Snow in three depth layers: near flakes are bigger, brighter and faster; all sway in the wind. */
    static void snow(Gfx g, float w, float h) {
        double t = System.currentTimeMillis() / 1000.0;
        for (float[] f : SNOW) {
            float depth = f[2];
            float y = (float) ((f[1] + t * 0.035 * depth) % 1.0) * (h + 10) - 5;
            float x = (float) ((f[0] + Math.sin(t * 0.6 + f[3]) * 0.012 + t * 0.004 * depth) % 1.0) * w;
            float r = 0.6f + depth * 1.3f;
            int a = (int) (60 + 150 * depth);
            Render2D.circle(g, x, y, r * 2.2f, ColorUtil.withAlpha(0xFFDCD2FF, a / 6));
            Render2D.circle(g, x, y, r, ColorUtil.withAlpha(0xFFFFFFFF, a));
        }
    }

    private static final int[] BULBS = {0xFFFF4D6D, 0xFFFFC23D, 0xFF3DDC97, 0xFF7FD0FF, 0xFFB48CFF};

    /** A sagging garland across the top edge from x0 to x1 with blinking bulbs. */
    static void garland(Gfx g, float x0, float x1, float y) {
        double t = System.currentTimeMillis() / 1000.0;
        float span = 46;
        int segs = Math.max(1, (int) ((x1 - x0) / span));
        span = (x1 - x0) / segs;
        int bulb = 0;
        for (int s = 0; s < segs; s++) {
            float sx = x0 + s * span;
            float px = sx, py = y;
            for (int k = 1; k <= 8; k++) {
                float u = k / 8f;
                float nx = sx + span * u, ny = y + (float) Math.sin(u * Math.PI) * 7;
                Render2D.line(g, px, py, nx, ny, 1.1f, 0xFF1E3A22);
                px = nx; py = ny;
            }
            for (int k = 1; k <= 3; k++) {
                float u = k / 4f;
                float bx = sx + span * u, by = y + (float) Math.sin(u * Math.PI) * 7 + 3;
                int c = BULBS[bulb++ % BULBS.length];
                float on = (float) (0.55 + 0.45 * Math.sin(t * 2.4 + bulb * 1.7));
                Render2D.circle(g, bx, by, 6, ColorUtil.withAlpha(c, (int) (55 * on)));
                Render2D.roundedRect(g, bx - 1.6f, by - 2.4f, 3.2f, 4.6f, 1.6f, ColorUtil.lerp(ColorUtil.withAlpha(c, 150), c, on));
                Render2D.rect(g, bx - 1, by - 3.6f, 2, 1.4f, 0xFF4A4A4A);
            }
        }
    }
}
