package dev.noreclient.cosmetic;

import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.geom.Path2D;
import java.awt.image.BufferedImage;

/**
 * "Aureola" – a polished ring floating above the head: it bobs, slowly spins, lags behind head
 * movement like something weightless and hops up on a jump. Variant with a crown of rays. With glow
 * (on by default) it shines additively with a soft bloom ring around it.
 */
final class Halo extends Item {
    private static final float RING = 3.7f, TUBE = 0.42f;

    Halo() {
        super("halo", "Aureola", Slot.AURA, "Unosi się nad głową • świeci");
        defaultColor = 0xFFD66B;
        palette = new int[]{0xFFD66B, 0xFFFFFF, 0x8FE3FF, 0xFF8AD0, 0xB98CFF, 0xFF4A3A};
        variants = new String[]{"ring", "rays"};
        variantNames = new String[]{"Pierścień", "Promienie"};
        glowOption = true;
        glowDefault = true;
        texW = 128;
        texH = 64;
    }

    @Override
    protected void build(Build b) {
        Wearer w = b.w;
        float t = b.t;
        float bob = (float) Math.sin(t * 1.6f) * 0.38f - Math.max(0, w.perk.x) * 0.12f + w.bobY.x * 0.5f;
        float tiltX = -12 + w.bobZ.x * 10 - w.lookPitch * 0.05f, tiltZ = -w.bobX.x * 10 + (float) Math.sin(t * 1.1f) * 3;
        boolean rays = "rays".equals(b.variant());
        Mesh[] meshes = {b.head(), b.glowHead()};
        for (int pass = 0; pass < 2; pass++) {
            Mesh m = meshes[pass];
            m.push();
            m.translate(0, -11.3f + bob, 0.4f).scale(b.s).rotateX(tiltX).rotateZ(tiltZ).rotateY(t * 35);
            if (pass == 0) {
                torus(m, RING, TUBE, 28, 6, 0, 0, 0.5f, 1);
                if (rays) {
                    for (int i = 0; i < 12; i++) {
                        float len = i % 2 == 0 ? 1.9f : 1.2f;
                        m.push().rotateY(i * 30).translate(RING + TUBE * 0.6f, 0, 0).rotateX(90);
                        m.quad(new float[][]{{0, -0.32f, 0}, {len, 0, 0}, {len, 0, 0}, {0, 0.32f, 0}}, new float[][]{{0.5f, 0.5f}, {1f, 0.75f}, {1f, 0.75f}, {0.5f, 1f}});
                        m.pop();
                    }
                }
            } else {
                // bloom: a flat ring of light around the halo, fading in and out across its width
                int seg = 32;
                float in = RING - 1.5f, out = RING + 1.8f + (rays ? 1 : 0);
                for (int j = 0; j < seg; j++) {
                    double a0 = j * Math.PI * 2 / seg, a1 = (j + 1) * Math.PI * 2 / seg;
                    float c0 = (float) Math.cos(a0), s0 = (float) Math.sin(a0), c1 = (float) Math.cos(a1), s1 = (float) Math.sin(a1);
                    m.quad(new float[][]{{c0 * in, 0, s0 * in}, {c0 * out, 0, s0 * out}, {c1 * out, 0, s1 * out}, {c1 * in, 0, s1 * in}},
                            new float[][]{{0.55f, 0f}, {0.55f, 0.5f}, {0.95f, 0.5f}, {0.95f, 0f}});
                }
            }
            m.pop();
        }
    }

    /** Torus in the XZ plane: u around the ring, v around the tube. */
    private static void torus(Mesh m, float R, float r, int seg, int sides, float u0, float v0, float u1, float v1) {
        for (int i = 0; i < seg; i++) {
            double a0 = i * Math.PI * 2 / seg, a1 = (i + 1) * Math.PI * 2 / seg;
            for (int j = 0; j < sides; j++) {
                double b0 = j * Math.PI * 2 / sides, b1 = (j + 1) * Math.PI * 2 / sides;
                float[] p00 = tp(R, r, a0, b0), p10 = tp(R, r, a1, b0), p11 = tp(R, r, a1, b1), p01 = tp(R, r, a0, b1);
                float ua = u0 + (u1 - u0) * i / seg, ub = u0 + (u1 - u0) * (i + 1) / seg;
                float va = v0 + (v1 - v0) * j / sides, vb = v0 + (v1 - v0) * (j + 1) / sides;
                m.quad(new float[][]{p00, p01, p11, p10}, new float[][]{{ua, va}, {ua, vb}, {ub, vb}, {ub, va}});
            }
        }
    }

    private static float[] tp(float R, float r, double a, double b) {
        float k = R + r * (float) Math.cos(b);
        return new float[]{(float) Math.cos(a) * k, r * (float) Math.sin(b), (float) Math.sin(a) * k};
    }

    @Override
    protected float[] previewFrame() { return new float[]{0, -11, 0, 9}; }

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
            g.setPaint(new GradientPaint(0, 0, Paint.c(Paint.shade(color, 1.3f)), 0, 32, Paint.c(color), true));
            g.fillRect(0, 0, 64, 64);
            // bloom gradient (u 70..122, v 0..32): transparent → bright → transparent across v
            for (int y = 0; y < 32; y++) {
                float f = y / 31f, k = (float) Math.exp(-Math.pow((f - 0.45f) / 0.2f, 2));
                g.setColor(Paint.c(Paint.mix(color, 0xFFFFFF, 0.3f), (int) (150 * k)));
                g.fillRect(64, y, 64, 1);
            }
            g.setColor(Paint.c(Paint.shade(color, 1.4f), 230));
            g.fillRect(64, 32, 64, 32);
            g.dispose();
            return img;
        }
        // polished metal around the tube: bright on top, a reflected rim below
        for (int y = 0; y < 64; y++) {
            float k = (float) Math.sin(y / 64.0 * Math.PI * 2);
            g.setColor(Paint.c(Paint.shade(color, 1 + k * 0.35f + (k > 0.8f ? 0.3f : 0))));
            g.fillRect(0, y, 64, 1);
        }
        Paint.speckle(g, 0, 0, 64, 64, 120, 2, 0xFFFFFF, 0);
        // rays: a flame-shaped gradient
        Path2D ray = new Path2D.Float();
        ray.moveTo(64, 32);
        ray.lineTo(128, 48);
        ray.lineTo(64, 64);
        ray.closePath();
        g.setPaint(new GradientPaint(64, 0, Paint.c(Paint.shade(color, 1.2f)), 128, 0, Paint.c(Paint.mix(color, 0xFFFFFF, 0.7f))));
        g.fill(ray);
        g.dispose();
        return img;
    }
}
