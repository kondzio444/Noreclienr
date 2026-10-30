package dev.noreclient.util;

import dev.noreclient.NoreClient;
import dev.noreclient.module.client.ClientSettings;

/**
 * Central palette for every GUI. Since the "Album" direction the constants are aliases of the
 * generated {@link ThemeTokens}; the accent stays user-themable through the "Client Settings" module.
 */
public final class Theme {
    private Theme() {}

    /** Album page (#141216, in-game alpha). */
    public static final int BG = ThemeTokens.PAGE;
    /** Fallback cover colour; use {@link #cover()} for the accent-dyed one. */
    public static final int SIDEBAR = 0xFF291C3D;
    /** Loose sheet (page-raised). */
    public static final int PANEL = 0xFF1E1B21;
    /** Sheet on a sheet, secondary buttons (page-raised-2). */
    public static final int CARD = 0xFF28242C;
    public static final int CARD_HOVER = 0xFF322D37;
    /** Surfaces separate by tone steps; the outline is only a hairline kept for older screens. */
    public static final int OUTLINE = 0x0FFFFFFF;
    public static final int TEXT = ThemeTokens.INK;
    public static final int TEXT_DIM = ThemeTokens.INK_SOFT;
    public static final int TEXT_MUTED = ThemeTokens.INK_FAINT;
    public static final int SUCCESS = ThemeTokens.DOT_READY;
    public static final int ERROR = ThemeTokens.DOT_ERROR;
    public static final int WARNING = ThemeTokens.DOT_WAIT;

    // Album extras
    public static final int PAGE = ThemeTokens.PAGE;
    public static final int PAGE_SOLID = ThemeTokens.PAGE_SOLID;
    public static final int RAISED = 0xFF1E1B21;
    public static final int RAISED_2 = 0xFF28242C;
    public static final int SLOT = ThemeTokens.SLOT;
    public static final int GHOST = ThemeTokens.GHOST;
    public static final int VINYL = ThemeTokens.VINYL;
    public static final int VINYL_INK = ThemeTokens.VINYL_INK;
    public static final int VINYL_INK_SOFT = 0xFF5D5560;
    public static final int PAPER = ThemeTokens.PAPER;
    /** Paper back seen under a peel corner. */
    public static final int PAPER_BACK = 0xFFD9D4CC;
    public static final int COVER_INK = 0xFFE9E2F5;
    public static final int COVER_INK_SOFT = 0xFFAB9FC0;
    /** Soft red of quit / disconnect rows. */
    public static final int DANGER_INK = 0xFFFFB0A8;

    private static ClientSettings settings() {
        NoreClient c = NoreClient.get();
        return c == null ? null : c.modules().get(ClientSettings.class);
    }

    public static int accent() { return accent(0); }

    public static int accent(long offset) {
        ClientSettings s = settings();
        if (s == null) return ThemeTokens.ACCENT;
        if (s.accentMode.is("Rainbow")) return ColorUtil.rainbow(offset, 0.6f, 0.65f, 1f, 255);
        if (s.accentMode.is("Wave")) return ColorUtil.wave(s.accent.get(), s.accent2.get(), offset, 0.8f);
        return s.accent.getColor(offset);
    }

    public static int accent2() {
        ClientSettings s = settings();
        if (s == null) return ThemeTokens.ACCENT_LIGHT;
        if (s.accentMode.is("Rainbow")) return ColorUtil.rainbow(1500, 0.6f, 0.65f, 1f, 255);
        return s.accent2.getColor();
    }

    /** accent-light: accent text and icons on the dark page. */
    public static int accentLight() { return ColorUtil.lerp(accent(), 0xFFFFFFFF, 0.36f); }

    /** accent-deep: fields that carry small white text. */
    public static int accentDeep() { return ColorUtil.lerp(accent(), 0xFF000000, 0.3f); }

    /** Album cover, derived from the accent (18% accent into #0f0d12). */
    public static int cover() {
        if (Events.halloween()) return ColorUtil.lerp(0xFF070609, accent(), 0.09f);
        if (Events.winter()) return ColorUtil.lerp(0xFF0D1220, accent(), 0.14f);
        return ColorUtil.lerp(0xFF0F0D12, accent(), 0.18f);
    }

    /** Page colour of the current event (album page otherwise), opaque. */
    public static int page() {
        if (Events.halloween()) return ThemeTokens.HALLOWEEN_PAGE;
        if (Events.winter()) return ThemeTokens.WINTER_PAGE;
        return ThemeTokens.PAGE_SOLID;
    }

    /** Sheet colour of the current event. */
    public static int raised() {
        if (Events.halloween()) return ThemeTokens.HALLOWEEN_PAGE_RAISED;
        if (Events.winter()) return ThemeTokens.WINTER_PAGE_RAISED;
        return RAISED;
    }

    public static float radius() {
        ClientSettings s = settings();
        return s == null ? ThemeTokens.RADIUS_STICKER : s.cornerRadius.floatValue();
    }

    public static boolean blur() {
        ClientSettings s = settings();
        return s != null && s.blur.isOn();
    }

    public static boolean sounds() {
        ClientSettings s = settings();
        return s == null || s.sounds.isOn();
    }
}
