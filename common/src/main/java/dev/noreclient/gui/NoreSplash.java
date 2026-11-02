package dev.noreclient.gui;

import dev.noreclient.api.Gfx;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import dev.noreclient.util.ThemeTokens;

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
        // the closed album: cover dyed with the accent, the logo sticker slapped in the middle
        Render2D.rect(g, 0, 0, width, height, Theme.cover());
        float cx = width / 2f, cy = height / 2f - 10;
        float size = Math.min(96, Math.min(width, height) * 0.22f);
        float k = dev.noreclient.util.Motion.stickScale(START + 150);
        g.push();
        g.translate(cx, cy);
        g.scale(k, k);
        dev.noreclient.gui.widget.Album.logo(g, -size / 2f, -size / 2f, size, alpha);
        g.pop();
        // progress: exact length on a slot track
        float bw = Math.min(220, width * 0.45f), bh = 4;
        float bx = cx - bw / 2f, by = cy + size / 2f + 22;
        Render2D.roundedRect(g, bx, by, bw, bh, bh / 2f, ThemeTokens.SLOT);
        float p = Math.max(0.02f, Math.min(1f, progress));
        Render2D.roundedRect(g, bx, by, bw * p, bh, bh / 2f, Theme.accent());
        g.setAlpha(1);
    }
}
