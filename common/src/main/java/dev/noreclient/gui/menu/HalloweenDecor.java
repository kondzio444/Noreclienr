package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;

import java.util.Calendar;

/**
 * Seasonal touch for the main menu: from 15 October to 3 November a little jack-o'-lantern sits next to the
 * Nore title and a few bats flutter across the empty middle of the screen. Pixel sprites, one draw call each.
 * {@code -Dnoreclient.halloween=true/false} forces it on or off (for testing).
 */
final class HalloweenDecor {
    private HalloweenDecor() {}

    private static long checkedAt;
    private static boolean active;

    /** True between 15 October and 3 November (system date); re-checked once a minute. */
    static boolean active() {
        long now = System.currentTimeMillis();
        if (now - checkedAt > 60_000L || checkedAt == 0) {
            checkedAt = now;
            String force = System.getProperty("noreclient.halloween", "");
            if (!force.isEmpty()) active = Boolean.parseBoolean(force);
            else {
                Calendar c = Calendar.getInstance();
                int month = c.get(Calendar.MONTH), day = c.get(Calendar.DAY_OF_MONTH);
                active = month == Calendar.OCTOBER && day >= 15 || month == Calendar.NOVEMBER && day <= 3;
            }
        }
        return active;
    }

    private static final String[] PUMPKIN = {
            ".....gl....",
            "...oOgOo...",
            ".ooOoooOoo.",
            "oOoYoOoYoOo",
            "oOYYoOoYYOo",
            "oOooOYOooOo",
            "oYoOoOoOoYo",
            "oOYYoYoYYOo",
            "dOoYYYYYoOd",
            ".ddOoOoOdd.",
            "...ddddd..."};

    private static final String[][] BAT = {
            {"X.......X",
             "XX.X.X.XX",
             ".XXeXeXX.",
             "..XXXXX..",
             "....X...."},
            {"...X.X...",
             "XX.XXX.XX",
             "XXXeXeXXX",
             "X..XXX..X",
             "....X...."},
            {"...X.X...",
             "..XeXeX..",
             ".XXXXXXX.",
             "XX.XXX.XX",
             "X...X...X"}};
    private static final int[] FLAP = {0, 1, 2, 1};

    private static final int[] PUMPKIN_COLORS = new int[6];

    /** Jack-o'-lantern of 11x11 pixels of size p at (x, y), its face flickering like a candle. */
    static void pumpkin(Gfx g, float x, float y, float p) {
        double s = System.currentTimeMillis() / 1000.0;
        float fl = (float) (0.75 + 0.12 * Math.sin(s * 7.3) + 0.08 * Math.sin(s * 13.1 + 1) + 0.05 * Math.sin(s * 23.7));
        float cx = x + 5.5f * p, cy = y + 6 * p;
        Render2D.radial(g, cx, cy, 9 * p, ColorUtil.withAlpha(0xFFFF8A1F, (int) (70 * fl)), 0);
        PUMPKIN_COLORS[0] = 0xFFE8721C;
        PUMPKIN_COLORS[1] = 0xFFC45610;
        PUMPKIN_COLORS[2] = 0xFF8C3208;
        PUMPKIN_COLORS[3] = 0xFF5E7A22;
        PUMPKIN_COLORS[4] = 0xFF7FB03A;
        PUMPKIN_COLORS[5] = ColorUtil.lerp(0xFFFF9A2A, 0xFFFFF0A0, fl);
        Render2D.pixels(g, PUMPKIN, "oOdglY", PUMPKIN_COLORS, x, y, p);
    }

    private static final int[] BAT_COLORS = new int[2];

    private static void bat(Gfx g, float x, float y, float p, int pose, int alpha) {
        String[] rows = BAT[FLAP[pose & 3]];
        BAT_COLORS[0] = ColorUtil.withAlpha(0xFF120A1C, (int) (alpha * 0.9f));
        BAT_COLORS[1] = ColorUtil.withAlpha(0xFFFF9A2A, alpha);
        Render2D.pixels(g, rows, "Xe", BAT_COLORS, x - 4.5f * p, y - 2.5f * p, p);
    }

    /** One small bat looping a lazy figure-eight in the empty strip above the title (x0..x1 around height y). */
    static void titleBat(Gfx g, float x0, float x1, float y) {
        long now = System.currentTimeMillis();
        double a = (now % 9000L) / 9000.0 * Math.PI * 2;
        float x = (x0 + x1) / 2f + (float) Math.sin(a) * (x1 - x0) / 2f;
        float by = y + (float) Math.sin(a * 2) * 3.5f;
        bat(g, x, by, 1f, (int) ((now / 120) % 4), 215);
    }

    /** {period ms, phase offset, flight band top (0..1 of the band height), size, direction}. */
    private static final float[][] FLIGHTS = {
            {17000, 0.00f, 0.10f, 1.25f, 1},
            {23000, 0.55f, 0.45f, 1.0f, -1},
            {29000, 0.30f, 0.75f, 0.8f, 1}};

    /**
     * A few bats crossing the area x0..x1, y0..y1 on slow wavy paths, fading in and out at the edges.
     * Drawn before the panels, so they only show over the panorama.
     */
    static void bats(Gfx g, float x0, float y0, float x1, float y1) {
        if (x1 - x0 < 40 || y1 - y0 < 30) return;
        long now = System.currentTimeMillis();
        for (int i = 0; i < FLIGHTS.length; i++) {
            float[] f = FLIGHTS[i];
            float u = (now % (long) f[0]) / f[0] + f[1];
            u -= (float) Math.floor(u);
            float k = f[4] > 0 ? u : 1 - u;
            float x = x0 + k * (x1 - x0);
            float y = y0 + f[2] * (y1 - y0) + (float) Math.sin(u * Math.PI * 4 + i) * 8;
            int alpha = (int) (230 * Math.min(1, Math.min(u, 1 - u) * 8));
            if (alpha < 8) continue;
            int pose = (int) ((now / 110 + i * 3) % 4);
            bat(g, x, y, f[3], pose, alpha);
        }
    }
}
