package dev.noreclient.util;

import dev.noreclient.NoreClient;
import dev.noreclient.module.client.ClientSettings;

/**
 * Album motion helpers: the "Animacje" setting (Pełne / Oszczędne / Wyłączone), cubic-bezier
 * easing from {@link ThemeTokens}, staggered entrances and the stick / peel micro-interactions.
 */
public final class Motion {
    public static final int FULL = 0, REDUCED = 1, OFF = 2;

    private Motion() {}

    public static int level() {
        NoreClient c = NoreClient.get();
        if (c == null) return FULL;
        ClientSettings s = c.modules().get(ClientSettings.class);
        if (s == null) return FULL;
        if (s.animations.is("Wyłączone")) return OFF;
        if (s.animations.is("Oszczędne")) return REDUCED;
        return FULL;
    }

    /** 1 when things may travel (slides, lifts, scale), 0 under reduced motion or with animations off. */
    public static float travel() { return level() == FULL ? 1f : 0f; }

    /** Ambient loops (bats, snow, flicker) only run with full motion. */
    public static boolean ambient() { return level() == FULL; }

    /** Duration scaled for the motion level (reduced: capped at 200 ms, off: 0). */
    public static float dur(int ms) {
        int l = level();
        if (l == OFF) return 0;
        if (l == REDUCED) return Math.min(200, ms);
        return ms;
    }

    /** Progress 0..1 of an animation started at {@code start} (+ delay) lasting {@code ms}, eased with {@code bezier}. */
    public static float progress(long start, long delay, int ms, float[] bezier) {
        float d = dur(ms);
        if (d <= 0) return 1;
        float t = (System.currentTimeMillis() - start - (level() == FULL ? delay : 0)) / d;
        return ease(bezier, t);
    }

    /** Entrance of the i-th item of a list: stagger 45 ms per item, at most 8 steps. */
    public static float enter(long start, int index) {
        long delay = (long) Math.min(index, ThemeTokens.STAGGER_MAX) * ThemeTokens.STAGGER_STEP;
        return progress(start, delay, ThemeTokens.DUR_STICK, ThemeTokens.EASE_OUT);
    }

    /** Screen entrance (sheet arrives): 0..1 over dur.page. */
    public static float screen(long start) {
        return progress(start, 0, ThemeTokens.DUR_PAGE, ThemeTokens.EASE_OUT);
    }

    /** spring.stick sampled analytically: scale from 1.12 settling to 1 with a small overshoot. */
    public static float stickScale(long start) {
        if (level() != FULL) return 1;
        float t = (System.currentTimeMillis() - start) / 1000f;
        if (t >= 0.5f) return 1;
        if (t < 0) return ThemeTokens.STICK_SCALE;
        float k = ThemeTokens.SPRING_STICK[0], c = ThemeTokens.SPRING_STICK[1], m = ThemeTokens.SPRING_STICK[2];
        float w0 = (float) Math.sqrt(k / m), z = c / (2 * (float) Math.sqrt(k * m));
        float wd = w0 * (float) Math.sqrt(1 - z * z);
        float x = (float) (Math.exp(-z * w0 * t) * (Math.cos(wd * t) + z * w0 / wd * Math.sin(wd * t)));
        return 1 + (ThemeTokens.STICK_SCALE - 1) * x;
    }

    /** Peel progress 0..1 over dur.peel with ease.peel (1 = gone). */
    public static float peel(long start) {
        return progress(start, 0, ThemeTokens.DUR_PEEL, ThemeTokens.EASE_PEEL);
    }

    /** Cubic-bezier easing (x1, y1, x2, y2) evaluated at t (0..1). */
    public static float ease(float[] b, float t) {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        float lo = 0, hi = 1, u = t;
        for (int i = 0; i < 18; i++) {
            u = (lo + hi) / 2f;
            float x = bez(b[0], b[2], u);
            if (x < t) lo = u; else hi = u;
        }
        return bez(b[1], b[3], u);
    }

    private static float bez(float p1, float p2, float u) {
        float v = 1 - u;
        return 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u;
    }
}
