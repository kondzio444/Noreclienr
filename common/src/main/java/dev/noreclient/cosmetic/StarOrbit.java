package dev.noreclient.cosmetic;

import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;

/**
 * "Orbita Gwiazd" – little stars (or snowflakes) circling the player on tilted orbits, each with a
 * short comet trail when glowing. The orbits widen when the player runs, pull in when sneaking,
 * rise while flying and wobble behind turns.
 */
final class StarOrbit extends Item {
    private static final int COUNT = 5;

    StarOrbit() {
        super("star_orbit", "Orbita Gwiazd", Slot.AURA, "Gwiazdy krążą wokół ciebie");
        defaultColor = 0xFFE27A;
        palette = new int[]{0xFFE27A, 0xFFFFFF, 0x8FE3FF, 0xFF8AD0, 0xB98CFF, 0x7CFFB0};
        variants = new String[]{"stars", "snow"};
        variantNames = new String[]{"Gwiazdy", "Płatki śniegu"};
        glowOption = true;
        glowDefault = true;
        texW = 128;
        texH = 64;
    }

    @Override
    protected void build(Build b) {
        Wearer w = b.w;
        float t = b.t;
        boolean snow = "snow".equals(b.variant());
        float u0 = snow ? 0.5f : 0f, u1 = snow ? 1f : 0.5f;
        float reach = 1 + w.speed * 0.25f - w.sneak * 0.2f;
        float rise = -w.flight * 3 - w.sneak * 1.5f;
        Mesh m = b.body(), g = b.glowBody();
        for (int i = 0; i < COUNT; i++) {
            float speed = 0.9f + i * 0.17f;
            float ang = t * speed * 70 + i * 72;
            float tilt = -18 + i * 9 + w.earSwing.x * 6;
            float r = (7.2f + (i % 3) * 0.9f) * reach;
            float y = 5.5f + (i - 2) * 1.6f + rise + (float) Math.sin(t * 1.3f + i) * 0.6f;
            float size = (snow ? 2.4f : 2.2f) * (0.8f + 0.2f * (float) Math.sin(t * 3 + i * 1.3f));
            for (int k = 0; k <= 3; k++) {
                // k = 0: the star itself, k > 0: its fading trail (glow only)
                float a = ang - k * 9f;
                Mesh dst = k == 0 ? m : g;
                if (k > 0) {
                    int c = (int) (200 * (1 - k / 4f));
                    g.color(c << 24 | c << 16 | c << 8 | c);
                }
                dst.push();
                dst.translate(0, y, 0).scale(b.s).rotateZ(tilt).rotateY(a).translate(r, 0, 0).rotateY(t * 120 + i * 50).rotateX(25);
                dst.star3(size * (1 - k * 0.2f), u0, 0, u1, 1);
                dst.pop();
            }
            g.color(-1);
        }
    }

    @Override
    protected float[] previewFrame() { return new float[]{0, 6, 0, 18}; }

    // ---------------------------------------------------------------- texture (128x64)

    @Override
    protected BufferedImage paint(int color, String variant) { return texture(color, false); }

    @Override
    protected BufferedImage paintGlow(int color, String variant) { return texture(color, true); }

    private static BufferedImage texture(int color, boolean mask) {
        BufferedImage img = Paint.image(128, 64);
        Graphics2D g = Paint.g(img);
        if (mask) {
            g.setColor(Color.BLACK);
            g.fillRect(0, 0, 128, 64);
            Paint.glow(g, 32, 32, 30, color, 150);
            Paint.glow(g, 96, 32, 30, Paint.mix(color, 0xFFFFFF, 0.5f), 130);
        }
        g.setPaint(new GradientPaint(16, 10, Paint.c(Paint.mix(color, 0xFFFFFF, 0.65f)), 48, 54, Paint.c(Paint.shade(color, 0.8f))));
        g.fill(Paint.star5(32, 34, 26, 0.45f));
        g.setColor(new Color(255, 255, 255, 170));
        g.fill(Paint.star5(30, 31, 9, 0.45f));
        Paint.snowflake(g, 96, 32, 26, Paint.mix(color, 0xFFFFFF, 0.6f), 255, 4.2f);
        Paint.snowflake(g, 96, 32, 26, 0xFFFFFF, 140, 1.6f);
        g.dispose();
        return img;
    }
}
