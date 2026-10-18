package dev.noreclient.cosmetic;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Platform;
import dev.noreclient.module.social.Cosmetics;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.Random;

/**
 * The secret: a tiny cat-ears button in the bottom-right corner of the main menu, right next to the
 * version line, almost invisible until the mouse finds it. Clicking it unlocks the fox and cat ears
 * and tails in the wardrobe with a little celebration (ears popping up, sparkles and paw prints,
 * a "Sekret odkryty!" toast); the unlock is saved in the config.
 */
public final class SecretEars {
    private static final long CELEBRATION = 5200;
    private static final Animation HOVER = new Animation(0, 12);
    private static long celebrated, poked;
    /** Set when the secret is found; the wardrobe reveals the new tiles with a shine once. */
    public static boolean justUnlocked;

    private SecretEars() {}

    private static Cosmetics module() {
        NoreClient c = NoreClient.get();
        return c == null ? null : c.modules().get(Cosmetics.class);
    }

    public static boolean unlocked() {
        Cosmetics m = module();
        return m != null && m.secret.isOn();
    }

    private static float[] rect(int width, int height) { return new float[]{width - 12.5f, height - 12.5f, 10, 10}; }

    /** Main menu hook: draws the button (and the celebration after a click). */
    public static void menu(Gfx g, int width, int height, int mx, int my) {
        float[] r = rect(width, height);
        boolean hov = Render2D.hovered(mx, my, r[0], r[1], r[2], r[3]);
        float h = HOVER.target(hov ? 1 : 0).update();
        long now = System.currentTimeMillis();
        float poke = poked == 0 ? 0 : Math.max(0, 1 - (now - poked) / 600f);
        float wiggle = (float) Math.sin(now / 90.0) * (h * 0.25f + poke);
        float a = 0.13f + 0.87f * h;
        float prev = g.getAlpha();
        g.setAlpha(prev * a);
        float cx = r[0] + r[2] / 2f, cy = r[1] + r[3] / 2f + 1;
        if (h > 0.02f) Render2D.radial(g, cx, cy, 9 * h, ColorUtil.withAlpha(Theme.accent(), (int) (70 * h)), 0);
        catIcon(g, cx, cy, 1 + 0.18f * h, ColorUtil.lerp(0xFFB9AECB, Theme.accent2(), h), wiggle);
        g.setAlpha(prev);
        if (h > 0.6f && celebrated == 0) {
            String tip = unlocked() ? "Miau." : "Hmm?";
            float tw = Render2D.textWidth(tip) * 0.65f + 8;
            g.setAlpha(prev * (h - 0.6f) / 0.4f);
            Render2D.roundedRect(g, r[0] + r[2] - tw, r[1] - 13, tw, 10, 4, 0xE0120E0B);
            Render2D.scaledText(g, tip, r[0] + r[2] - tw + 4, r[1] - 10.5f, 0.65f, Theme.TEXT, false);
            g.setAlpha(prev);
        }
        if (celebrated != 0) {
            long age = now - celebrated;
            if (age > CELEBRATION) celebrated = 0;
            else celebration(g, width, height, cx, cy, age);
        }
        if (!started) {
            started = true;
            Wardrobe.publish();
        }
    }

    private static boolean started;

    /** Main menu hook: true when the click hit the button. */
    public static boolean menuClick(double mx, double my, int width, int height) {
        float[] r = rect(width, height);
        if (!Render2D.hovered(mx, my, r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2)) return false;
        Cosmetics m = module();
        if (m == null) return true;
        if (!m.secret.isOn()) {
            m.secret.set(true);
            justUnlocked = true;
            NoreClient.get().config().save();
            Wardrobe.publish();
            celebrated = System.currentTimeMillis();
            try {
                Platform.game().playClick(1.8f);
                Platform.game().playClick(2.0f);
            } catch (Throwable ignored) { /* no sound */ }
        } else {
            poked = System.currentTimeMillis();
            try { Platform.game().playClick(2.0f); } catch (Throwable ignored) { /* no sound */ }
        }
        return true;
    }

    /** Ears popping up in the middle of the screen, sparkles and paw prints, then the toast. */
    private static void celebration(Gfx g, int width, int height, float bx, float by, long age) {
        float t = age / 1000f;
        float fadeIn = Animation.easeOutCubic(t / 0.35f), fadeOut = 1 - Animation.easeOutCubic((t - 3.2f) / 0.8f);
        float dim = Math.min(fadeIn, fadeOut);
        Render2D.rect(g, 0, 0, width, height, ColorUtil.withAlpha(0xFF05030A, (int) (165 * dim)));
        float cx = width / 2f, cy = height / 2f - 10;
        // burst of sparkles and paw prints from the button towards the centre and beyond
        Random r = new Random(42);
        for (int i = 0; i < 36; i++) {
            float delay = r.nextFloat() * 0.5f, life = 1.6f + r.nextFloat() * 1.2f;
            float p = (t - delay) / life;
            if (p <= 0 || p >= 1) continue;
            double ang = r.nextFloat() * Math.PI * 2;
            float dist = 40 + r.nextFloat() * Math.min(width, height) * 0.45f;
            float e = Animation.easeOutCubic(p);
            float x = cx + (float) Math.cos(ang) * dist * e, y = cy + (float) Math.sin(ang) * dist * e + p * p * 30;
            if (p < 0.15f) { x = bx + (x - bx) * p / 0.15f; y = by + (y - by) * p / 0.15f; }
            int alpha = (int) (255 * (1 - p) * dim);
            int col = i % 3 == 0 ? Theme.accent2() : i % 3 == 1 ? 0xFFFFC2E0 : 0xFFFFE08A;
            if (i % 4 == 0) paw(g, x, y, 2.4f + r.nextFloat() * 1.5f, ColorUtil.withAlpha(col, alpha), (float) ang);
            else dev.noreclient.gui.widget.Icons.sparkle(g, x, y, 2 + r.nextFloat() * 3, ColorUtil.withAlpha(col, alpha));
        }
        // the ears: pop in with overshoot, wiggle, glow
        float pop = Animation.easeOutBack(Math.min(1, t / 0.55f));
        float s = 6.5f * pop * (0.85f + 0.15f * fadeOut);
        float wig = (float) Math.sin(t * 14) * Math.max(0, 1 - t / 1.6f) * 1.4f + (float) Math.sin(t * 3) * 0.15f;
        g.setAlpha(Math.max(0, Math.min(1, fadeOut)));
        Render2D.radial(g, cx, cy, 48 * pop, ColorUtil.withAlpha(Theme.accent(), (int) (110 * dim)), 0);
        Render2D.ring(g, cx, cy, 30 + t * 60, 2, 0, 360, ColorUtil.withAlpha(Theme.accent2(), (int) (180 * Math.max(0, 1 - t / 1.2f))));
        catIcon(g, cx, cy, s, 0xFFFFFFFF, wig);
        float tp = Animation.easeOutCubic((t - 0.45f) / 0.5f);
        if (tp > 0) {
            g.setAlpha(Math.max(0, Math.min(1, fadeOut)) * tp);
            String title = "Sekret odkryty!";
            float cw = Math.max(Render2D.textWidth(title) * 1.8f, Render2D.textWidth("Uszy i ogony Lisa i Kota czekają w Szatni") * 0.8f) + 24;
            Render2D.roundedRect(g, cx - cw / 2f, cy + 30 + (1 - tp) * 8, cw, 38, 8, 0xC0100A1C);
            Render2D.gradientText(g, title, cx - Render2D.textWidth(title) * 0.9f, cy + 36 + (1 - tp) * 8, 1.8f, Theme.accent2(), 0xFFFFC2E0, true);
            String sub = "Uszy i ogony Lisa i Kota czekają w Szatni";
            Render2D.scaledText(g, sub, cx - Render2D.textWidth(sub) * 0.4f, cy + 56 + (1 - tp) * 8, 0.8f, Theme.TEXT_DIM, true);
        }
        g.setAlpha(1);
        // toast in the corner (the in-game toasts are not drawn on the main menu)
        float slide = Animation.easeOutCubic((t - 0.9f) / 0.4f) * (1 - Animation.easeOutCubic((t - 4.6f) / 0.5f));
        if (slide > 0) {
            float w = 178, hh = 30, x = width - 8 - w + (1 - slide) * (w + 14), y = height - 50;
            float rr = Theme.radius();
            Render2D.shadow(g, x, y, w, hh, rr, 5, ColorUtil.withAlpha(Theme.accent(), 80));
            Render2D.roundedRect(g, x, y, w, hh, rr, 0xF0160F26);
            Render2D.roundedOutline(g, x, y, w, hh, rr, 1, ColorUtil.withAlpha(Theme.accent2(), 170));
            Render2D.roundedRect(g, x + 6, y + 7, 16, 16, 8, ColorUtil.withAlpha(Theme.accent(), 70));
            catIcon(g, x + 14, y + 16, 0.9f, Theme.accent2(), (float) Math.sin(t * 10) * 0.3f);
            Render2D.text(g, "Sekret odkryty!", x + 28, y + 6, Theme.TEXT, false);
            Render2D.scaledText(g, "Nowe uszy i ogony w Szatni", x + 28, y + 18, 0.75f, Theme.TEXT_DIM, false);
            float progress = 1 - Math.max(0, Math.min(1, (t - 0.9f) / 3.7f));
            Render2D.roundedRect(g, x + 4, y + hh - 2.5f, (w - 8) * progress, 1.5f, 0.75f, Theme.accent2());
        }
    }

    /** A little cat head: two pointy ears (pink inside) on a round head with eyes; s = scale (1 ≈ 8 px wide), wiggle tilts the ears. */
    public static void catIcon(Gfx g, float cx, float cy, float s, int color, float wiggle) {
        int a = ColorUtil.alpha(color);
        int inner = ColorUtil.withAlpha(0xFFFF9EB5, a);
        for (int side = -1; side <= 1; side += 2) {
            float ox = cx + side * 1.9f * s, oy = cy - 0.6f * s;
            double tilt = side * (0.12 + 0.3 * wiggle);
            float[] b1 = rot(cx + side * 0.5f * s, cy - 1.6f * s, ox, oy, tilt), b2 = rot(cx + side * 3.3f * s, cy + 0.4f * s, ox, oy, tilt);
            float[] tip = rot(cx + side * 2.9f * s, cy - 4.6f * s, ox, oy, tilt);
            g.mesh(Gfx.TRIANGLES, new float[]{b1[0], b1[1], tip[0], tip[1], b2[0], b2[1]}, new int[]{color, color, color}, 3);
            float[] i1 = rot(cx + side * 1.3f * s, cy - 1.5f * s, ox, oy, tilt), i2 = rot(cx + side * 2.8f * s, cy - 0.4f * s, ox, oy, tilt);
            float[] it = rot(cx + side * 2.65f * s, cy - 3.5f * s, ox, oy, tilt);
            g.mesh(Gfx.TRIANGLES, new float[]{i1[0], i1[1], it[0], it[1], i2[0], i2[1]}, new int[]{inner, inner, inner}, 3);
        }
        Render2D.circle(g, cx, cy + 0.9f * s, 3.3f * s, color);
        int eye = ColorUtil.withAlpha(0xFF1A1424, a);
        Render2D.circle(g, cx - 1.25f * s, cy + 0.8f * s, 0.55f * s, eye);
        Render2D.circle(g, cx + 1.25f * s, cy + 0.8f * s, 0.55f * s, eye);
        Render2D.circle(g, cx, cy + 1.9f * s, 0.35f * s, inner);
    }

    private static float[] rot(float x, float y, float ox, float oy, double a) {
        float c = (float) Math.cos(a), sn = (float) Math.sin(a), dx = x - ox, dy = y - oy;
        return new float[]{ox + dx * c - dy * sn, oy + dx * sn + dy * c};
    }

    /** A paw print: a pad and four toes. */
    private static void paw(Gfx g, float x, float y, float s, int color, float ang) {
        Render2D.circle(g, x, y + s * 0.4f, s, color);
        for (int i = 0; i < 4; i++) {
            double a = Math.toRadians(-150 + i * 40);
            Render2D.circle(g, x + (float) Math.cos(a) * s * 1.6f, y + (float) Math.sin(a) * s * 1.5f, s * 0.42f, color);
        }
    }
}
