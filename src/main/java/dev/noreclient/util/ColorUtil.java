package dev.noreclient.util;

import java.awt.Color;

/** Helpers for working with packed ARGB colours. */
public final class ColorUtil {
    private ColorUtil() {}

    public static int alpha(int c) { return (c >>> 24) & 0xFF; }
    public static int red(int c) { return (c >> 16) & 0xFF; }
    public static int green(int c) { return (c >> 8) & 0xFF; }
    public static int blue(int c) { return c & 0xFF; }

    public static int argb(int a, int r, int g, int b) {
        return (clamp(a) << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
    }

    private static int clamp(int v) { return Math.max(0, Math.min(255, v)); }

    public static int withAlpha(int c, int a) { return (c & 0x00FFFFFF) | (clamp(a) << 24); }

    /** Multiplies the existing alpha of the colour by {@code f} (0..1). */
    public static int fade(int c, float f) {
        return withAlpha(c, Math.round(alpha(c) * Math.max(0f, Math.min(1f, f))));
    }

    public static int lerp(int a, int b, float t) {
        t = Math.max(0f, Math.min(1f, t));
        return argb(
                Math.round(alpha(a) + (alpha(b) - alpha(a)) * t),
                Math.round(red(a) + (red(b) - red(a)) * t),
                Math.round(green(a) + (green(b) - green(a)) * t),
                Math.round(blue(a) + (blue(b) - blue(a)) * t));
    }

    public static int brighten(int c, float f) {
        return argb(alpha(c),
                Math.round(red(c) + (255 - red(c)) * f),
                Math.round(green(c) + (255 - green(c)) * f),
                Math.round(blue(c) + (255 - blue(c)) * f));
    }

    public static int darken(int c, float f) {
        return argb(alpha(c), Math.round(red(c) * (1 - f)), Math.round(green(c) * (1 - f)), Math.round(blue(c) * (1 - f)));
    }

    public static int hsb(float h, float s, float b, int alpha) {
        return withAlpha(Color.HSBtoRGB(h, s, b), alpha);
    }

    public static float[] toHsb(int c) {
        return Color.RGBtoHSB(red(c), green(c), blue(c), null);
    }

    /** A rainbow colour that cycles over time; {@code offset} shifts the phase (e.g. per line). */
    public static int rainbow(long offsetMs, float speed, float saturation, float brightness, int alpha) {
        double period = 4000.0 / Math.max(0.05, speed);
        float hue = (float) (((System.currentTimeMillis() + offsetMs) % period) / period);
        return hsb(hue, saturation, brightness, alpha);
    }

    /** Smoothly blends between two colours over time, used for the accent "wave" effect. */
    public static int wave(int a, int b, long offsetMs, float speed) {
        double period = 3000.0 / Math.max(0.05, speed);
        double t = ((System.currentTimeMillis() + offsetMs) % period) / period;
        return lerp(a, b, (float) (0.5 + 0.5 * Math.sin(t * Math.PI * 2)));
    }

    public static String toHex(int c) {
        return String.format("#%08X", c);
    }
}
