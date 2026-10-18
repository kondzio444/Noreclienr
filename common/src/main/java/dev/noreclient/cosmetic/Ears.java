package dev.noreclient.cosmetic;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.geom.Line2D;
import java.awt.image.BufferedImage;
import java.util.Random;

/**
 * The secret ears ("Uszy Lisa", "Uszy Kota"): two scooped ears (fur outside, a soft inner ear with
 * tufts inside) that are alive. They twitch and flick now and then, flatten when sneaking or hurt,
 * swing behind quick head turns, fold back when sprinting or flying, perk up on a jump and flop
 * on landing, and turn a little towards where the player looks.
 */
final class Ears extends Item {
    private final boolean fox;
    private final float baseX, width, height, depth;

    private Ears(String id, String name, String desc, boolean fox) {
        super(id, name, Slot.EARS, desc);
        this.fox = fox;
        secret = true;
        texW = 128;
        texH = 128;
        if (fox) {
            baseX = 2.55f; width = 3.5f; height = 4.6f; depth = 1.15f;
            defaultColor = 0xE8732A;
            palette = new int[]{0xE8732A, 0xA8461E, 0xF2EFE8, 0x8A8E9A, 0x2E2A2E, 0xD9A05B};
            variants = new String[]{"classic", "fluffy"};
            variantNames = new String[]{"Klasyczne", "Puszyste"};
        } else {
            baseX = 2.45f; width = 3.2f; height = 3.3f; depth = 0.95f;
            defaultColor = 0x2A262C;
            palette = new int[]{0x2A262C, 0xF4F1EC, 0xE8913E, 0x8E8C94, 0xE6D2AE, 0x7A5638};
            variants = new String[]{"plain", "tabby"};
            variantNames = new String[]{"Gładkie", "Pręgowane"};
        }
    }

    static Ears fox() { return new Ears("fox_ears", "Uszy Lisa", "Sekret • strzygą uszami na każdy ruch", true); }

    static Ears cat() { return new Ears("cat_ears", "Uszy Kota", "Sekret • drgają, kładą się po sobie", false); }

    @Override
    protected void build(Build b) {
        Wearer w = b.w;
        float t = b.t;
        float back = Math.max(Math.max(w.sprint, w.flight), w.speed * 0.55f + w.swim * 0.5f);
        float flat = Math.max(w.sneak * 0.85f, w.hurt);
        float breathe = (float) Math.sin(t * 1.4f) * 1.5f;
        Mesh m = b.head();
        for (int side = 0; side < 2; side++) {
            float twitch = side == 0 ? w.twitchL : w.twitchR;
            float sg = side == 0 ? 1 : -1; // mirrors world-space directions onto the second ear
            float pitch = (fox ? -6 : -3) - 50 * back - 22 * flat + w.perk.x * 3.2f + w.lookPitch * 0.08f + breathe * (1 - back);
            float roll = (fox ? 9 : 12) + 52 * flat * (1 - back * 0.5f) + 26 * w.earSwing.x * sg + twitch * 14 - Math.max(0, w.perk.x) * 1.5f;
            float yaw = (fox ? 10 : 14) + w.lookYaw * 0.22f * sg + twitch * 34 + 10 * flat;
            float stretch = 1 + Math.max(-0.12f, Math.min(0.12f, w.perk.x * 0.02f));
            m.push();
            if (side == 1) m.scale(-1, 1, 1);
            m.translate(baseX, -7.85f, 0.35f).scale(b.s);
            m.rotateY(yaw).rotateX(pitch).rotateZ(roll).scale(1, stretch, 1);
            ear(m, "fluffy".equals(b.variant()));
            m.pop();
        }
    }

    /** One ear in local space: base on y = 0 centred on x = 0, tip up (-y); the opening faces -z. */
    private void ear(Mesh m, boolean fluffy) {
        int rows = 6;
        float[][] l = new float[rows + 1][], r = new float[rows + 1][], bk = new float[rows + 1][], fr = new float[rows + 1][];
        for (int i = 0; i <= rows; i++) {
            float f = i / (float) rows;
            float wd = width * (float) Math.pow(1 - f, fox ? 0.85 : 0.95) * (1 + 0.14f * (float) Math.sin(Math.PI * f)) * 0.5f;
            float d = depth * (1 - f * 0.85f);
            float cx = (fox ? 0.35f : 0.25f) * f * f;
            float y = -height * f;
            float edgeZ = -0.15f * (float) Math.sin(Math.PI * f);
            l[i] = new float[]{cx - wd, y, edgeZ};
            r[i] = new float[]{cx + wd, y, edgeZ};
            bk[i] = new float[]{cx, y, d};
            fr[i] = new float[]{cx, y, d * 0.42f};
        }
        for (int i = 0; i < rows; i++) {
            float v0 = 1 - i / (float) rows, v1 = 1 - (i + 1) / (float) rows;
            // outer fur (back of the ear), u 0..0.5
            m.quad(new float[][]{l[i], l[i + 1], bk[i + 1], bk[i]}, new float[][]{{0, v0}, {0, v1}, {0.25f, v1}, {0.25f, v0}});
            m.quad(new float[][]{bk[i], bk[i + 1], r[i + 1], r[i]}, new float[][]{{0.25f, v0}, {0.25f, v1}, {0.5f, v1}, {0.5f, v0}});
            // inner ear, u 0.5..1, v 0.25..1 (the top quarter holds the tuft sprite)
            float w0 = 0.25f + 0.75f * v0, w1 = 0.25f + 0.75f * v1;
            m.quad(new float[][]{fr[i], fr[i + 1], l[i + 1], l[i]}, new float[][]{{0.75f, w0}, {0.75f, w1}, {0.5f, w1}, {0.5f, w0}});
            m.quad(new float[][]{r[i], r[i + 1], fr[i + 1], fr[i]}, new float[][]{{1f, w0}, {1f, w1}, {0.75f, w1}, {0.75f, w0}});
        }
        // bottom cap so the ear has no hole where it meets the head
        m.quad(new float[][]{l[0], bk[0], r[0], fr[0]}, new float[][]{{0.1f, 0.95f}, {0.25f, 0.95f}, {0.4f, 0.95f}, {0.25f, 0.95f}});
        // tufts of fur sticking out of the inner ear
        int tufts = fluffy ? 3 : 2;
        for (int k = 0; k < tufts; k++) {
            float f = 0.12f + k * 0.16f;
            m.push().translate((k - (tufts - 1) / 2f) * width * 0.16f, -height * f, depth * 0.2f - 0.05f).rotateX(14 + k * 6).rotateZ((k - 0.8f) * 18);
            float tw = width * (fluffy ? 0.42f : 0.32f), th = height * (fluffy ? 0.55f : 0.42f);
            m.plane(-tw / 2, -th, tw / 2, 0, 0.5f, 0.0f, 1f, 0.25f);
            m.pop();
        }
    }

    @Override
    protected float[] previewFrame() { return new float[]{0, -10, 0, 10}; }

    // ---------------------------------------------------------------- texture (128x128)

    @Override
    protected BufferedImage paint(int color, String variant) {
        BufferedImage img = Paint.image(128, 128);
        Graphics2D g = Paint.g(img);
        // outer fur, base (v = 1, bottom) to tip (v = 0, top)
        int tip = fox ? (Paint.luma(color) > 0.7f ? Paint.shade(color, 0.86f) : 0x231C1E) : Paint.shade(color, 0.85f);
        g.setPaint(new GradientPaint(0, 128, Paint.c(Paint.shade(color, 0.9f)), 0, 0, Paint.c(color)));
        g.fillRect(0, 0, 64, 128);
        if (fox) {
            g.setPaint(new GradientPaint(0, 30, Paint.c(tip, 0), 0, 6, Paint.c(tip, 255)));
            g.fillRect(0, 0, 64, 34);
        }
        if ("tabby".equals(variant)) {
            g.setStroke(new BasicStroke(5f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.setColor(Paint.c(Paint.shade(color, Paint.luma(color) > 0.6f ? 0.72f : 0.55f), 210));
            for (int i = 0; i < 3; i++) g.draw(new Line2D.Float(14 + i * 18, 128, 22 + i * 14, 54));
        }
        Paint.fur(g, 0, 0, 64, 128, color, 0, -1, 10, 520, fox ? 11 : 12);
        // inner ear: soft pale fur (fox) or pink skin with a fringe (cat), darker towards the base
        Random r = new Random(5);
        int inner = fox ? 0xF4EADC : (Paint.luma(color) > 0.7f ? 0xF0A8B4 : 0xE58A9A);
        g.setPaint(new GradientPaint(0, 0, Paint.c(Paint.shade(inner, 1.05f)), 0, 128, Paint.c(Paint.shade(inner, 0.72f))));
        g.fillRect(64, 32, 64, 96);
        g.setPaint(new GradientPaint(64, 0, new Color(0, 0, 0, 0), 96, 0, new Color(0, 0, 0, 70), true));
        g.fillRect(64, 32, 64, 96);
        Paint.fur(g, 64, 40, 64, 88, fox ? 0xFFFFFF : 0xF8E8EA, 0, -1, 9, fox ? 420 : 160, 21);
        // the rim of the opening: a few outer-colour hairs at the edges
        g.setStroke(new BasicStroke(1.2f));
        for (int i = 0; i < 90; i++) {
            float y = 32 + r.nextFloat() * 96;
            boolean left = r.nextBoolean();
            float x = left ? 64 + r.nextFloat() * 5 : 128 - r.nextFloat() * 5;
            g.setColor(Paint.c(Paint.shade(color, 0.9f + r.nextFloat() * 0.4f), 200));
            g.draw(new Line2D.Float(x, y, x + (left ? 4 : -4), y - 5));
        }
        // tuft sprite (v 0..0.25 of the inner half): wisps with transparent gaps
        for (int i = 0; i < 70; i++) {
            float x0 = 70 + r.nextFloat() * 52;
            g.setColor(Paint.c(fox ? 0xFFFBF2 : 0xFFF4F4, 160 + r.nextInt(90)));
            g.setStroke(new BasicStroke(1.3f + r.nextFloat(), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.draw(new java.awt.geom.QuadCurve2D.Float(96, 31, (96 + x0) / 2f + (r.nextFloat() - 0.5f) * 8, 16, x0, 1 + r.nextFloat() * 8));
        }
        g.dispose();
        return img;
    }
}
