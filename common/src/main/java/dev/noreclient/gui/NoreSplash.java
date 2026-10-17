package dev.noreclient.gui;

import dev.noreclient.api.Gfx;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

/**
 * Loading screen drawn over the vanilla (Mojang) one while resources load. Uses no text, because
 * fonts are not available yet during the first load.
 */
public final class NoreSplash {
    private static final long START = System.currentTimeMillis();

    private NoreSplash() {}

    public static void render(Gfx g, int width, int height, float progress, float alpha) {
        CurrentGfx.set(g);
        g.setAlpha(alpha);
        float t = (System.currentTimeMillis() - START) / 1000f;
        Render2D.rect(g, 0, 0, width, height, 0xFF0B0908);
        Render2D.quadGradient(g, 0, 0, width, height, 0x00000000, ColorUtil.withAlpha(Theme.accent(), 26), 0x00000000, ColorUtil.withAlpha(Theme.accent2(), 18));
        float cx = width / 2f, cy = height / 2f - 10;
        float size = Math.min(96, Math.min(width, height) * 0.22f);
        float pulse = 0.85f + 0.15f * (float) Math.sin(t * 2.4);
        Render2D.radial(g, cx, cy, size * 1.25f * pulse, ColorUtil.withAlpha(Theme.accent(), 90), ColorUtil.withAlpha(Theme.accent(), 0));
        Render2D.logo(g, cx - size / 2f, cy - size / 2f, size, 1f);
        // orbiting spark
        double a = t * 2.2;
        float orbit = size * 0.78f;
        Render2D.circle(g, cx + (float) Math.cos(a) * orbit, cy + (float) Math.sin(a) * orbit * 0.35f, 2f, ColorUtil.withAlpha(Theme.accent2(), 220));
        // progress bar
        float bw = Math.min(220, width * 0.45f), bh = 4;
        float bx = cx - bw / 2f, by = cy + size / 2f + 22;
        Render2D.roundedRect(g, bx, by, bw, bh, bh / 2f, 0x30FFFFFF);
        float p = Math.max(0.02f, Math.min(1f, progress));
        Render2D.shadow(g, bx, by, bw * p, bh, bh / 2f, 4, ColorUtil.withAlpha(Theme.accent(), 120));
        Render2D.roundedGradient(g, bx, by, bw * p, bh, bh / 2f, Theme.accent(), Theme.accent2(), false);
        g.setAlpha(1);
    }
}
