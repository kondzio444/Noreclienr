package dev.noreclient.util;

import dev.noreclient.NoreClient;
import dev.noreclient.module.client.ClientSettings;

/** Central palette for every GUI, driven by the "Client Settings" module. */
public final class Theme {
    private Theme() {}

    public static final int BG = 0xF2100D0B;
    public static final int SIDEBAR = 0xFF14100D;
    public static final int PANEL = 0xFF1A1512;
    public static final int CARD = 0xFF201A16;
    public static final int CARD_HOVER = 0xFF2A221C;
    public static final int OUTLINE = 0x22FFFFFF;
    public static final int TEXT = 0xFFF6EFE8;
    public static final int TEXT_DIM = 0xFFB4A395;
    public static final int TEXT_MUTED = 0xFF75675C;
    public static final int SUCCESS = 0xFF34D399;
    public static final int ERROR = 0xFFF87171;
    public static final int WARNING = 0xFFFBBF24;

    private static ClientSettings settings() {
        NoreClient c = NoreClient.get();
        return c == null ? null : c.modules().get(ClientSettings.class);
    }

    public static int accent() { return accent(0); }

    public static int accent(long offset) {
        ClientSettings s = settings();
        if (s == null) return 0xFFFF8A1F;
        if (s.accentMode.is("Rainbow")) return ColorUtil.rainbow(offset, 0.6f, 0.65f, 1f, 255);
        if (s.accentMode.is("Wave")) return ColorUtil.wave(s.accent.get(), s.accent2.get(), offset, 0.8f);
        return s.accent.getColor(offset);
    }

    public static int accent2() {
        ClientSettings s = settings();
        if (s == null) return 0xFFFFB547;
        if (s.accentMode.is("Rainbow")) return ColorUtil.rainbow(1500, 0.6f, 0.65f, 1f, 255);
        return s.accent2.getColor();
    }

    public static float radius() {
        ClientSettings s = settings();
        return s == null ? 6 : s.cornerRadius.floatValue();
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
