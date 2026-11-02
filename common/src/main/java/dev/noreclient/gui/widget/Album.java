package dev.noreclient.gui.widget;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.TextureRef;
import dev.noreclient.util.BundledTextures;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Events;
import dev.noreclient.util.Motion;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import dev.noreclient.util.ThemeTokens;

/**
 * The "Album" component kit for the in-game client (DESIGN.md §5 and §8): album sheets, die-cut
 * stickers with a 1 GUI px vinyl rim, ghost slots with a dashed die line, dot stickers for state,
 * peel corners, washi tape, keycaps, label stickers, paper clippings, pill buttons, switches and
 * sliders. Everything is drawn with {@link Render2D}; nothing rotates (Gfx has no rotation).
 * Text is Minecraft's own font at integer scales.
 */
public final class Album {
    private Album() {}

    public static final float R = ThemeTokens.RADIUS_STICKER;

    // ------------------------------------------------------------------ surfaces

    /** Album sheet (page, 92% alpha) – the ground of a panel. */
    public static void sheet(Gfx g, float x, float y, float w, float h) {
        Render2D.roundedRect(g, x, y, w, h, R, ColorUtil.withAlpha(Theme.page(), 0xEB));
    }

    /** Raised loose sheet (settings groups, menus). */
    public static void raised(Gfx g, float x, float y, float w, float h) {
        Render2D.roundedRect(g, x, y, w, h, R, Theme.raised());
    }

    /** Floating layer (modal, toast, tooltip): sheet with the float shadow. */
    public static void floating(Gfx g, float x, float y, float w, float h, int face) {
        Render2D.shadow(g, x, y + 2, w, h, R, 6, 0xB0000000);
        Render2D.roundedRect(g, x, y, w, h, R, face);
    }

    /** Cover-coloured spine strip on the left edge of a sheet. */
    public static void spine(Gfx g, float x, float y, float h) {
        Render2D.roundedRect(g, x, y, 5, h, 2, Theme.cover());
        Render2D.rect(g, x + 2, y, 3, h, Theme.cover());
    }

    /**
     * Sticker: a vinyl rim 1 GUI px larger than the face, flat at rest. {@code lift} 0..1 raises it
     * by 1 GUI px with the lift shadow (it is being peeled / hovered).
     */
    public static void sticker(Gfx g, float x, float y, float w, float h, int face, float lift) {
        sticker(g, x, y, w, h, R, face, lift);
    }

    public static void sticker(Gfx g, float x, float y, float w, float h, float r, int face, float lift) {
        float l = lift * ThemeTokens.LIFT_PX * Motion.travel();
        y -= l;
        if (lift > 0.01f) Render2D.shadow(g, x, y + 2, w, h, r, 4, ColorUtil.withAlpha(0xFF000000, (int) (150 * lift)));
        Render2D.roundedRect(g, x - 1, y - 1, w + 2, h + 2, r + 1, ColorUtil.withAlpha(Theme.VINYL, ColorUtil.alpha(face)));
        Render2D.roundedRect(g, x, y, w, h, r, face);
    }

    /** White sticker (vinyl face, dark text). */
    public static void white(Gfx g, float x, float y, float w, float h, float lift) {
        sticker(g, x, y, w, h, Theme.VINYL, lift);
    }

    /**
     * Peel corner in the top-right of a sticker: the page shows where the corner lifted and the
     * cream paper back of the sticker is folded over it. {@code size} in GUI px (~6–7).
     */
    public static void peel(Gfx g, float right, float top, float size, int under) {
        if (size < 0.5f) return;
        float[] xy = {
                // cut-out: page colour above the fold
                right - size, top - 1, right + 1, top - 1, right + 1, top + size,
                // folded paper back
                right - size, top - 1, right + 1, top + size, right - size, top + size};
        int[] c = {under, under, under, Theme.PAPER_BACK, Theme.PAPER_BACK, ColorUtil.darken(Theme.PAPER_BACK, 0.12f)};
        g.mesh(Gfx.TRIANGLES, xy, c, 6);
    }

    /** Ghost slot: recessed well with a dashed die line inset 3 px (what goes here when it is on). */
    public static void slot(Gfx g, float x, float y, float w, float h) {
        slot(g, x, y, w, h, R);
    }

    public static void slot(Gfx g, float x, float y, float w, float h, float r) {
        Render2D.roundedRect(g, x, y, w, h, r, Theme.SLOT);
        dashed(g, x + 3, y + 3, w - 6, h - 6, Theme.GHOST);
    }

    /** Dashed rectangle outline (2 px dashes, 2 px gaps, 1 px line). */
    public static void dashed(Gfx g, float x, float y, float w, float h, int color) {
        if (w < 4 || h < 4) return;
        for (float i = 0; i < w; i += 4) {
            float dw = Math.min(2, w - i);
            Render2D.rect(g, x + i, y, dw, 1, color);
            Render2D.rect(g, x + i, y + h - 1, dw, 1, color);
        }
        for (float j = 2; j < h - 2; j += 4) {
            float dh = Math.min(2, h - 2 - j);
            Render2D.rect(g, x, y + j, 1, dh, color);
            Render2D.rect(g, x + w - 1, y + j, 1, dh, color);
        }
    }

    /** Dot sticker: state colour with a 1 GUI px vinyl rim. */
    public static void dot(Gfx g, float cx, float cy, float r, int color) {
        Render2D.circle(g, cx, cy, r + 1, Theme.VINYL);
        Render2D.circle(g, cx, cy, r, color);
    }

    /** Washi tape strip, a slightly skewed quad with ragged ends. */
    public static void tape(Gfx g, float x, float y, float w, float h, int color) {
        float sk = 1.5f;
        float[] xy = {x + sk, y, x, y + h, x + w - sk, y + h, x + w, y};
        int[] c = {color, color, color, color};
        g.mesh(Gfx.QUADS, xy, c, 4);
        int notch = ColorUtil.withAlpha(color, ColorUtil.alpha(color) / 2);
        for (int i = 0; i < 3; i++) {
            Render2D.rect(g, x + sk - 1, y + 1 + i * (h / 3f), 1, h / 6f, notch);
            Render2D.rect(g, x + w - sk, y + 1 + i * (h / 3f), 1, h / 6f, notch);
        }
    }

    /** Paper clipping (news, session) with a tape strip on its top edge. */
    public static void clipping(Gfx g, float x, float y, float w, float h, int tapeColor, float tapeX) {
        Render2D.shadow(g, x, y + 1, w, h, 2, 3, 0x60000000);
        Render2D.roundedRect(g, x, y, w, h, 2, Theme.PAPER);
        if (tapeColor != 0) tape(g, x + tapeX, y - 4, 30, 8, tapeColor);
    }

    /** Keycap (P.Shift, F2, Esc). Returns its width. */
    public static float keycap(Gfx g, String key, float x, float y) {
        float w = Render2D.textWidth(key) + 6;
        Render2D.roundedRect(g, x, y + 1, w, 10, 2, 0xFF000000);
        Render2D.roundedRect(g, x, y, w, 10, 2, Theme.PAGE_SOLID);
        Render2D.text(g, key, x + 3, y + 1, Theme.TEXT_DIM, false);
        return w;
    }

    public static float keycapWidth(String key) { return Render2D.textWidth(key) + 6; }

    /** Keycap printed on a white sticker (light chip, dark text). */
    public static float keycapLight(Gfx g, String key, float x, float y) {
        float w = Render2D.textWidth(key) + 4;
        Render2D.roundedRect(g, x, y, w, 10, 2, 0xFFE4E0DA);
        Render2D.text(g, key, x + 2, y + 1, Theme.VINYL_INK, false);
        return w;
    }

    /** Label sticker (loader, version, rank, "nowy"): small rounded chip with a vinyl rim. Returns width. */
    public static float label(Gfx g, String text, float x, float y, int fill, int ink) {
        float w = Render2D.textWidth(text) + 5;
        Render2D.roundedRect(g, x - 1, y - 1, w + 2, 12, 3, Theme.VINYL);
        Render2D.roundedRect(g, x, y, w, 10, 2, fill);
        Render2D.text(g, text, x + 3, y + 1, ink, false);
        return w;
    }

    public static float labelWidth(String text) { return Render2D.textWidth(text) + 5; }

    // ------------------------------------------------------------------ text

    /** Minecraft text at 2x (titles). */
    public static void title(Gfx g, String s, float x, float y, int color) {
        Render2D.scaledText(g, s, x, y, 2f, color, false);
    }

    public static void titleShadow(Gfx g, String s, float x, float y, int color) {
        Render2D.scaledText(g, s, x, y, 2f, color, true);
    }

    /** Text drawn with the given colour, or nothing when empty. */
    public static void text(Gfx g, String s, float x, float y, int color) {
        Render2D.text(g, s, x, y, color, false);
    }

    public static void right(Gfx g, String s, float rightX, float y, int color) {
        Render2D.text(g, s, rightX - Render2D.textWidth(s), y, color, false);
    }

    // ------------------------------------------------------------------ controls

    public static final int PRIMARY = 0, WHITE = 1, SECONDARY = 2, QUIET = 3, DANGER = 4, DEEP = 5;

    /**
     * Pill button. PRIMARY = accent with vinyl rim (the one violet hero), WHITE = vinyl pill,
     * SECONDARY = page-raised-2 pill, DEEP = accent-deep sticker button, QUIET = text only,
     * DANGER = slot pill with soft red text. {@code hover} 0..1 lifts it; {@code press} flattens.
     */
    public static void button(Gfx g, float x, float y, float w, float h, String label, int style, float hover) {
        button(g, x, y, w, h, label, style, hover, true);
    }

    public static void button(Gfx g, float x, float y, float w, float h, String label, int style, float hover, boolean enabled) {
        float r = h / 2f;
        int face, ink;
        switch (style) {
            case PRIMARY: face = Theme.accent(); ink = 0xFFFFFFFF; break;
            case DEEP: face = Theme.accentDeep(); ink = 0xFFFFFFFF; break;
            case WHITE: face = Theme.VINYL; ink = Theme.VINYL_INK; break;
            case DANGER: face = ColorUtil.lerp(Theme.RAISED_2, 0xFF3A1F22, hover); ink = Theme.DANGER_INK; break;
            case QUIET: face = 0; ink = ColorUtil.lerp(Theme.accentLight(), 0xFFFFFFFF, hover); break;
            default: face = ColorUtil.lerp(Theme.RAISED_2, Theme.CARD_HOVER, hover); ink = Theme.TEXT; break;
        }
        if (!enabled) {
            face = Theme.SLOT;
            ink = Theme.TEXT_MUTED;
        }
        if (style == QUIET) {
            float tw = Render2D.textWidth(label);
            float tx = x + (w - tw) / 2f, ty = y + (h - 8) / 2f;
            Render2D.text(g, label, tx, ty, ink, false);
            Render2D.rect(g, tx, ty + 9 + 1, tw * Math.max(0.35f, hover), 1, Theme.accentLight());
            return;
        }
        if (enabled && (style == PRIMARY || style == WHITE || style == DEEP)) sticker(g, x, y, w, h, r, face, hover);
        else {
            float l = hover * Motion.travel();
            Render2D.roundedRect(g, x, y - l, w, h, r, face);
            y -= l;
        }
        if (enabled && style != SECONDARY && style != DANGER) y -= hover * ThemeTokens.LIFT_PX * Motion.travel();
        Render2D.text(g, label, x + (w - Render2D.textWidth(label)) / 2f, y + (h - 8) / 2f, ink, false);
    }

    /** Switch: a dot sticker on a slot track; off = grey dot left, on = accent dot right on a 34% accent track. */
    public static void toggle(Gfx g, float x, float y, float w, float h, float p) {
        int track = ColorUtil.lerp(Theme.SLOT, ColorUtil.withAlpha(ColorUtil.lerp(Theme.SLOT, Theme.accent(), 0.34f), 0xFF), p);
        Render2D.roundedRect(g, x, y, w, h, h / 2f, track);
        float kr = h / 2f - 2;
        float kx = x + h / 2f + (w - h) * p;
        dot(g, kx, y + h / 2f, kr, ColorUtil.lerp(ThemeTokens.DOT_OFF, Theme.accent(), p));
    }

    /** Slider: slot track, accent fill of the exact value length, white dot thumb with an accent centre. */
    public static void slider(Gfx g, float x, float y, float w, float p, float hover) {
        p = Math.max(0, Math.min(1, p));
        float th = 4;
        Render2D.roundedRect(g, x, y, w, th, th / 2f, Theme.SLOT);
        if (p > 0) Render2D.roundedRect(g, x, y, Math.max(th, w * p), th, th / 2f, Theme.accent());
        float cx = x + w * p, cy = y + th / 2f, r = 3.5f + hover * 0.6f;
        Render2D.circle(g, cx, cy + 1, r + 1, 0x60000000);
        Render2D.circle(g, cx, cy, r + 1, Theme.VINYL);
        Render2D.circle(g, cx, cy, r - 1.6f, Theme.accent());
    }

    /**
     * Menu row (main menu, pause): plain text on the page at rest; hovered it becomes a white
     * sticker with a peel corner and an accent icon. {@code style}: 0 normal, 1 primary (violet
     * pill), 2 danger (soft red).
     */
    public static void row(Gfx g, float x, float y, float w, float h, float hover, int style, int under) {
        if (style == 1) {
            sticker(g, x, y, w, h, h / 2f, ColorUtil.lerp(Theme.accent(), ColorUtil.brighten(Theme.accent(), 0.08f), hover), hover);
            return;
        }
        if (hover < 0.02f) return;
        float a = Math.min(1, hover * 1.6f);
        int face = ColorUtil.withAlpha(style == 2 ? 0xFFFFE9E6 : Theme.VINYL, (int) (255 * a));
        sticker(g, x, y, w, h, R, face, hover);
        float l = hover * ThemeTokens.LIFT_PX * Motion.travel();
        peel(g, x + w, y - l, 5 + 2 * hover, under);
    }

    /** Text colour of a menu row at the given hover. */
    public static int rowInk(float hover, int style) {
        if (style == 1) return 0xFFFFFFFF;
        if (style == 2) return ColorUtil.lerp(Theme.DANGER_INK, 0xFFB3261E, Math.min(1, hover * 1.6f));
        return ColorUtil.lerp(Theme.TEXT, Theme.VINYL_INK, Math.min(1, hover * 1.6f));
    }

    public static int rowIcon(float hover, int style) {
        if (style == 1) return 0xFFFFFFFF;
        if (style == 2) return ColorUtil.lerp(Theme.DANGER_INK, 0xFFB3261E, Math.min(1, hover * 1.6f));
        return ColorUtil.lerp(Theme.TEXT_DIM, Theme.accent(), Math.min(1, hover * 1.6f));
    }

    // ------------------------------------------------------------------ art

    /** The die-cut logo sticker (accent stays on the logo layer). Falls back to the plain logo. */
    public static void logo(Gfx g, float x, float y, float size, float alpha) {
        TextureRef t = BundledTextures.get("logo_sticker");
        if (t == null) t = BundledTextures.logo();
        Render2D.texture(g, t, x, y, size, size, alpha);
    }

    /** A bundled sticker sprite (ghost_sticker, pumpkin_sticker, bat_sticker, cape_dynia...) scaled to height h. */
    public static float sprite(Gfx g, String name, float x, float y, float h, float alpha) {
        TextureRef t = BundledTextures.get(name);
        if (t == null || t.height <= 0) return 0;
        float w = h * t.width / (float) t.height;
        Render2D.texture(g, t, x, y, w, h, alpha);
        return w;
    }

    /** Phosphor halo behind a glow-in-the-dark sticker (the only glow in the system). */
    public static void phosphor(Gfx g, float cx, float cy, float radius, float strength) {
        Render2D.radial(g, cx, cy, radius, ColorUtil.withAlpha(ThemeTokens.HALLOWEEN_PHOSPHOR, (int) (110 * strength)), 0x00D2FF7A);
    }

    /** Small head sticker: face texture inside a vinyl rim, with an optional state dot. */
    public static void head(Gfx g, TextureRef tex, float x, float y, float size, int dotColor) {
        Render2D.roundedRect(g, x - 1, y - 1, size + 2, size + 2, 2, Theme.VINYL);
        if (tex != null) Render2D.texture(g, tex, x, y, size, size, 1f);
        else Render2D.roundedRect(g, x, y, size, size, 1, 0xFF5D5560);
        if (dotColor != 0) dot(g, x + size, y + size, 1.8f, dotColor);
    }

    /** Count-down / event dot (dot-event) used in the ClickGUI and pause menu during events. */
    public static void eventDot(Gfx g, float cx, float cy) {
        if (!Events.any()) return;
        dot(g, cx, cy, 2, Events.halloween() ? ThemeTokens.HALLOWEEN_PUMPKIN : ThemeTokens.WINTER_ICE);
    }

    /** Scrim behind a modal (flat, no blur). */
    public static void scrim(Gfx g, float w, float h, float a) {
        Render2D.rect(g, 0, 0, w, h, ColorUtil.withAlpha(ThemeTokens.SCRIM, (int) (ColorUtil.alpha(ThemeTokens.SCRIM) * a)));
    }
}
