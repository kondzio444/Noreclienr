package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.TextureRef;
import dev.noreclient.util.BundledTextures;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Heads;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.Locale;

/** Small pieces shared by the friends screen and the player menu: heads, the Nore badge, states. */
public final class SocialWidgets {
    public static final int NORE = 0xFFFF8A3D;
    public static final int VERIFIED = 0xFF34D399;
    public static final int UNVERIFIED = 0xFFFBBF24;

    private SocialWidgets() {}

    /** Player head (skin face) or a lettered placeholder while it loads. */
    public static void head(Gfx g, String name, float x, float y, float s) {
        TextureRef head = Heads.get(name);
        if (head != null) {
            Render2D.texture(g, head, x, y, s, s, 1f);
            return;
        }
        Render2D.roundedRect(g, x, y, s, s, Math.max(2, s / 6f), 0x40FFFFFF);
        String l = name == null || name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase(Locale.ROOT);
        float ts = s / 14f;
        Render2D.scaledText(g, l, x + s / 2f - Render2D.textWidth(l) * ts / 2f, y + s / 2f - 3.5f * ts, ts, Theme.TEXT_DIM, false);
    }

    /** The Nore logo mark (size px) with a small verified tick or an amber dot. */
    public static void mark(Gfx g, float x, float y, float size, boolean verified, boolean known) {
        TextureRef logo = BundledTextures.logo();
        if (logo != null) Render2D.texture(g, logo, x, y, size, size, 1f);
        else Render2D.circle(g, x + size / 2f, y + size / 2f, size / 2f, NORE);
        if (!known) return;
        float r = Math.max(1.6f, size * 0.22f);
        float cx = x + size - r * 0.6f, cy = y + size - r * 0.6f;
        Render2D.circle(g, cx, cy, r + 0.8f, 0xFF120C1E);
        Render2D.circle(g, cx, cy, r, verified ? VERIFIED : UNVERIFIED);
    }

    /**
     * Pill "Nore ✓ zweryfikowany" / "Nore · niezweryfikowany" / "Nore" (chat contact only).
     * Returns its width.
     */
    public static float badge(Gfx g, float x, float y, boolean verified, boolean known, boolean longForm) {
        String label = !known ? "Nore" : verified ? (longForm ? "Nore  ✓ zweryfikowany" : "Nore ✓") : (longForm ? "Nore  · niezweryfikowany" : "Nore");
        float ts = 0.62f;
        float w = 13 + Render2D.textWidth(label) * ts + 5, h = 10;
        int col = !known ? NORE : verified ? VERIFIED : UNVERIFIED;
        Render2D.roundedRect(g, x, y, w, h, 5, ColorUtil.withAlpha(col, 40));
        Render2D.roundedOutline(g, x, y, w, h, 5, 1, ColorUtil.withAlpha(col, 120));
        TextureRef logo = BundledTextures.logo();
        if (logo != null) Render2D.texture(g, logo, x + 2, y + 1, 8, 8, 1f);
        Render2D.scaledText(g, label, x + 12, y + 2.5f, ts, ColorUtil.lerp(col, 0xFFFFFFFF, 0.35f), false);
        return w;
    }

    /** Pill for a plain label (friend, muted…). Returns its width. */
    public static float pill(Gfx g, float x, float y, String label, int col) {
        float ts = 0.62f;
        float w = Render2D.textWidth(label) * ts + 10, h = 10;
        Render2D.roundedRect(g, x, y, w, h, 5, ColorUtil.withAlpha(col, 36));
        Render2D.roundedOutline(g, x, y, w, h, 5, 1, ColorUtil.withAlpha(col, 110));
        Render2D.scaledText(g, label, x + 5, y + 2.5f, ts, ColorUtil.lerp(col, 0xFFFFFFFF, 0.35f), false);
        return w;
    }

    /** Colour of a state: 2 on this server, 1 online in Nore, 0 offline. */
    public static int stateColor(int state) {
        return state == 2 ? Theme.SUCCESS : state == 1 ? Theme.accent() : 0xFF6A6280;
    }
}
