package dev.noreclient.util;

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

    /** HSB → RGB (same algorithm as java.awt.Color, without loading AWT). */
    public static int hsb(float hue, float saturation, float brightness, int alpha) {
        int r = 0, g = 0, b = 0;
        if (saturation == 0) {
            r = g = b = (int) (brightness * 255.0f + 0.5f);
        } else {
            float h = (hue - (float) Math.floor(hue)) * 6.0f;
            float f = h - (float) Math.floor(h);
            float p = brightness * (1.0f - saturation);
            float q = brightness * (1.0f - saturation * f);
            float t = brightness * (1.0f - (saturation * (1.0f - f)));
            switch ((int) h) {
                case 0: r = (int) (brightness * 255 + .5f); g = (int) (t * 255 + .5f); b = (int) (p * 255 + .5f); break;
                case 1: r = (int) (q * 255 + .5f); g = (int) (brightness * 255 + .5f); b = (int) (p * 255 + .5f); break;
                case 2: r = (int) (p * 255 + .5f); g = (int) (brightness * 255 + .5f); b = (int) (t * 255 + .5f); break;
                case 3: r = (int) (p * 255 + .5f); g = (int) (q * 255 + .5f); b = (int) (brightness * 255 + .5f); break;
                case 4: r = (int) (t * 255 + .5f); g = (int) (p * 255 + .5f); b = (int) (brightness * 255 + .5f); break;
                default: r = (int) (brightness * 255 + .5f); g = (int) (p * 255 + .5f); b = (int) (q * 255 + .5f); break;
            }
        }
        return argb(alpha, r, g, b);
    }

    public static float[] toHsb(int c) {
        int r = red(c), g = green(c), b = blue(c);
        int max = Math.max(r, Math.max(g, b)), min = Math.min(r, Math.min(g, b));
        float brightness = max / 255.0f;
        float saturation = max != 0 ? (max - min) / (float) max : 0;
        float hue = 0;
        if (saturation != 0) {
            float rc = (max - r) / (float) (max - min), gc = (max - g) / (float) (max - min), bc = (max - b) / (float) (max - min);
            if (r == max) hue = bc - gc;
            else if (g == max) hue = 2.0f + rc - bc;
            else hue = 4.0f + gc - rc;
            hue = hue / 6.0f;
            if (hue < 0) hue = hue + 1.0f;
        }
        return new float[]{hue, saturation, brightness};
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
