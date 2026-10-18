package dev.noreclient.cosmetic;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.geom.Line2D;
import java.awt.image.BufferedImage;
import java.util.Random;

/**
 * "Czapka Zimowa" – a knitted beanie with a ribbed cuff, a nordic snowflake band and a fluffy pompom
 * on a springy stem: the pompom bounces on every jump and landing, swings when the head turns and
 * leans back when running. Variant with ear flaps whose braided strings and little pompoms swing.
 * Colour: the wool (the pattern stays white).
 */
final class WinterHat extends Item {
    private static final int SIDES = 28, RINGS = 8;
    private static final float RIM_Y = -3.5f, R = 4.88f, H = 5.9f;

    WinterHat() {
        super("winter_hat", "Czapka Zimowa", Slot.HAT, "Na zimę • pompon, który podskakuje");
        defaultColor = 0xC8283C;
        palette = new int[]{0xC8283C, 0x1F4E8C, 0x2E7D4F, 0xF2EEE6, 0x3A3A44, 0xF2A33A};
        variants = new String[]{"pompom", "earflaps"};
        variantNames = new String[]{"Z pomponem", "Z nausznikami"};
        texW = texH = 256;
    }

    /** Rounded-square radius so the beanie hugs the cube head. */
    private static float squircle(float phi) {
        double c = Math.abs(Math.cos(phi)), s = Math.abs(Math.sin(phi));
        return (float) (1 / Math.pow(Math.pow(c, 4) + Math.pow(s, 4), 0.25));
    }

    private static float[] dome(float s, float phi, float slouchZ, float slouchX) {
        double th = s * Math.PI / 2;
        float rr = R * (float) Math.pow(Math.cos(th), 0.62) * (s < 0.999f ? 1 : 0);
        float sq = 1 + (squircle(phi) - 1) * (1 - s) * 0.85f;
        float k = s * s;
        return new float[]{(float) Math.cos(phi) * rr * sq + slouchX * k, RIM_Y - H * (float) Math.sin(th), (float) Math.sin(phi) * rr * sq + slouchZ * k};
    }

    @Override
    protected void build(Build b) {
        Wearer w = b.w;
        float t = b.t;
        float slouchZ = 0.5f + w.bobZ.x * 0.5f, slouchX = -w.bobX.x * 0.4f;
        Mesh m = b.head();
        m.push();
        m.translate(0, RIM_Y, 0).scale(b.s).translate(0, -RIM_Y, 0);
        // dome: knit with the snowflake band at the bottom
        for (int i = 0; i < RINGS; i++) {
            float s0 = i / (float) RINGS, s1 = (i + 1) / (float) RINGS;
            for (int j = 0; j < SIDES; j++) {
                float p0 = (float) (j * Math.PI * 2 / SIDES), p1 = (float) ((j + 1) * Math.PI * 2 / SIDES);
                float u0 = j / (float) SIDES, u1 = (j + 1) / (float) SIDES;
                float v0 = 0.5f * (1 - s0), v1 = 0.5f * (1 - s1);
                m.quad(new float[][]{dome(s0, p0, slouchZ, slouchX), dome(s1, p0, slouchZ, slouchX), dome(s1, p1, slouchZ, slouchX), dome(s0, p1, slouchZ, slouchX)},
                        new float[][]{{u0, v0}, {u0, v1}, {u1, v1}, {u1, v0}});
            }
        }
        // ribbed cuff, folded up over the dome's edge
        float cr = R + 0.32f, cy0 = RIM_Y + 0.35f, cy1 = RIM_Y - 2.1f;
        for (int j = 0; j < SIDES; j++) {
            float p0 = (float) (j * Math.PI * 2 / SIDES), p1 = (float) ((j + 1) * Math.PI * 2 / SIDES);
            float q0 = squircle(p0) * cr, q1 = squircle(p1) * cr;
            float u0 = j / (float) SIDES, u1 = (j + 1) / (float) SIDES;
            float[] a = {(float) Math.cos(p0) * q0, cy0, (float) Math.sin(p0) * q0}, bb = {(float) Math.cos(p0) * q0, cy1, (float) Math.sin(p0) * q0};
            float[] c = {(float) Math.cos(p1) * q1, cy1, (float) Math.sin(p1) * q1}, d = {(float) Math.cos(p1) * q1, cy0, (float) Math.sin(p1) * q1};
            m.quad(new float[][]{a, bb, c, d}, new float[][]{{u0, 0.6875f}, {u0, 0.5f}, {u1, 0.5f}, {u1, 0.6875f}});
            // lip on top of the cuff back to the dome
            float in0 = squircle(p0) * (R - 0.05f), in1 = squircle(p1) * (R - 0.05f);
            float[] e = {(float) Math.cos(p0) * in0, cy1 + 0.1f, (float) Math.sin(p0) * in0}, f = {(float) Math.cos(p1) * in1, cy1 + 0.1f, (float) Math.sin(p1) * in1};
            m.quad(new float[][]{bb, e, f, c}, new float[][]{{u0, 0.52f}, {u0, 0.5f}, {u1, 0.5f}, {u1, 0.52f}});
        }
        boolean flaps = "earflaps".equals(b.variant());
        if (flaps) {
            for (int side = 0; side < 2; side++) {
                m.push();
                if (side == 1) m.scale(-1, 1, 1);
                earFlap(m, w, t, side);
                m.pop();
            }
        }
        // pompom on a springy stem
        float[] top = dome(1, 0, slouchZ, slouchX);
        float px = top[0] - w.bobX.x * 1.6f, pz = top[2] + w.bobZ.x * 1.4f + 0.2f;
        float py = top[1] - 1.55f + w.bobY.x * 0.9f - Math.max(0, w.perk.x) * 0.08f;
        float squash = 1 + Math.max(-0.25f, Math.min(0.25f, w.bobY.x * 0.25f));
        float pr = flaps ? 1.55f : 1.95f;
        fluffy(m, px, py, pz, pr / (float) Math.sqrt(squash), pr * squash, 0, 0.6875f, 0.5f, 1f, 41);
        m.pop();
    }

    /** Ear flap with a braided string and a small pompom that swing with the head. */
    private void earFlap(Mesh m, Wearer w, float t, int side) {
        float x = R * squircle(0) * 0.98f + 0.18f;
        float y0 = RIM_Y + 0.2f, y1 = RIM_Y + 3.7f;
        float sw = (side == 0 ? 1 : -1);
        m.push().translate(x, 0, 0).rotateZ(4 + w.bobX.x * 6 * sw);
        // the flap: a rounded trapezoid with some thickness
        float fz = 2.6f, th = 0.35f;
        float u0 = 0.5f, u1 = 1f, v0 = 0.6875f, v1 = 1f;
        m.quad(new float[][]{{th, y0, -fz}, {th, y1 - 0.8f, -fz + 1.1f}, {th, y1 - 0.8f, fz - 1.1f}, {th, y0, fz}}, new float[][]{{u0, v0}, {u0, v1}, {u1, v1}, {u1, v0}});
        m.quad(new float[][]{{th, y1 - 0.8f, -fz + 1.1f}, {th, y1, -0.6f}, {th, y1, 0.6f}, {th, y1 - 0.8f, fz - 1.1f}}, new float[][]{{u0, v1}, {u0, v1}, {u1, v1}, {u1, v1}});
        m.quad(new float[][]{{0, y0, fz}, {0, y1 - 0.8f, fz - 1.1f}, {0, y1 - 0.8f, -fz + 1.1f}, {0, y0, -fz}}, new float[][]{{u0, v0}, {u0, v1}, {u1, v1}, {u1, v0}});
        m.quad(new float[][]{{0, y1 - 0.8f, -fz + 1.1f}, {th, y1 - 0.8f, -fz + 1.1f}, {th, y0, -fz}, {0, y0, -fz}}, new float[][]{{u0, v0}, {u0, v1}, {u1, v1}, {u1, v0}});
        m.quad(new float[][]{{0, y1 - 0.8f, fz - 1.1f}, {0, y0, fz}, {th, y0, fz}, {th, y1 - 0.8f, fz - 1.1f}}, new float[][]{{u0, v0}, {u0, v1}, {u1, v1}, {u1, v0}});
        // string: a pendulum hanging from the flap's tip
        float swing = w.bobX.x * 18 * sw + w.bobZ.x * 4 + 6 * (float) Math.sin(t * 2.1f + side) * (0.3f + w.speed);
        float back = w.bobZ.x * 22 + w.speed * 10;
        int n = 6;
        float[][] sp = new float[n][];
        float[] rad = new float[n];
        float len = 4.2f;
        for (int i = 0; i < n; i++) {
            float f = i / (n - 1f);
            double a = Math.toRadians(swing * f), bk = Math.toRadians(back * f);
            sp[i] = new float[]{th * 0.5f + (float) Math.sin(a) * len * f, y1 + (float) (Math.cos(a) * Math.cos(bk)) * len * f, (float) Math.sin(bk) * len * f};
            rad[i] = 0.28f;
        }
        m.tube(sp, rad, 5, 0.25f, 0.69f, 0.5f, 1f);
        float[] e = sp[n - 1];
        fluffy(m, e[0], e[1] + 0.7f, e[2], 0.85f, 0.85f, 0, 0.6875f, 0.5f, 1f, 17 + side);
        m.pop();
    }

    /** A fluffy ball: a sphere with a jittered radius so it reads as yarn tufts. */
    private static void fluffy(Mesh m, float cx, float cy, float cz, float rh, float rv, float u0, float v0, float u1, float v1, long seed) {
        int rings = 7, sides = 12;
        float[][][] p = new float[rings + 1][sides + 1][];
        Random r = new Random(seed);
        float[][] jit = new float[rings + 1][sides];
        for (int i = 0; i <= rings; i++) for (int j = 0; j < sides; j++) jit[i][j] = 1 + (r.nextFloat() - 0.5f) * 0.22f;
        for (int i = 0; i <= rings; i++) {
            double th = Math.PI * i / rings;
            for (int j = 0; j <= sides; j++) {
                double ph = Math.PI * 2 * j / sides;
                float k = i == 0 || i == rings ? 1 : jit[i][j % sides];
                p[i][j] = new float[]{cx + rh * k * (float) (Math.sin(th) * Math.cos(ph)), cy - rv * k * (float) Math.cos(th), cz + rh * k * (float) (Math.sin(th) * Math.sin(ph))};
            }
        }
        for (int i = 0; i < rings; i++) {
            for (int j = 0; j < sides; j++) {
                float ua = u0 + (u1 - u0) * j / sides, ub = u0 + (u1 - u0) * (j + 1) / sides;
                float va = v0 + (v1 - v0) * i / rings, vb = v0 + (v1 - v0) * (i + 1) / rings;
                m.quad(new float[][]{p[i][j], p[i + 1][j], p[i + 1][j + 1], p[i][j + 1]}, new float[][]{{ua, va}, {ua, vb}, {ub, vb}, {ub, va}});
            }
        }
    }

    @Override
    protected float topY(Worn w) { return -3.5f - 11.5f * w.scale; }

    @Override
    protected float[] previewFrame() { return new float[]{0, -6, 0, 16}; }

    // ---------------------------------------------------------------- texture (256x256)

    @Override
    protected BufferedImage paint(int color, String variant) {
        BufferedImage img = Paint.image(256, 256);
        Graphics2D g = Paint.g(img);
        boolean pale = Paint.luma(color) > 0.75f;
        int accent = pale ? 0xB8283C : 0xF6F2EA;
        // dome: knit stitches, the snowflake band near the cuff (bottom of the region)
        knit(g, 0, 0, 256, 128, color, 5);
        g.setColor(Paint.c(accent));
        g.fillRect(0, 104, 256, 3);
        g.fillRect(0, 80, 256, 2);
        for (int i = 0; i < 8; i++) {
            float cx = 16 + i * 32;
            Paint.snowflake(g, cx, 93, 7, accent, 255, 1.6f);
        }
        for (int i = 0; i < 16; i++) {
            float cx = i * 16 + 8;
            g.fill(new java.awt.Polygon(new int[]{(int) cx - 4, (int) cx, (int) cx + 4}, new int[]{78, 74, 78}, 3));
        }
        knitOverlay(g, 0, 74, 256, 36);
        // ribbed cuff: vertical ribs
        for (int x = 0; x < 256; x += 8) {
            g.setPaint(new GradientPaint(x, 0, Paint.c(Paint.shade(color, 1.12f)), x + 8, 0, Paint.c(Paint.shade(color, 0.62f))));
            g.fillRect(x, 128, 8, 48);
        }
        Paint.speckle(g, 0, 128, 256, 48, 700, 8, 0xFFFFFF, 0);
        g.setColor(new Color(0, 0, 0, 60));
        g.fillRect(0, 128, 256, 3);
        // pompom: dense tufts
        g.setColor(Paint.c(pale ? Paint.shade(color, 0.92f) : accent));
        g.fillRect(0, 176, 128, 80);
        Paint.fur(g, 0, 176, 128, 80, pale ? Paint.shade(color, 0.92f) : accent, 0.4f, 1f, 9, 900, 3);
        // flaps and strings
        knit(g, 128, 176, 128, 80, color, 9);
        g.setColor(Paint.c(accent));
        for (int i = 0; i < 4; i++) Paint.snowflake(g, 144 + i * 32, 214, 6, accent, 230, 1.4f);
        g.setColor(Paint.c(accent));
        g.fillRect(64, 176, 64, 6);
        g.dispose();
        return img;
    }

    /** V-shaped knit stitches over a base colour. */
    private static void knit(Graphics2D g, int x, int y, int w, int h, int color, long seed) {
        g.setColor(Paint.c(color));
        g.fillRect(x, y, w, h);
        Random r = new Random(seed);
        g.setStroke(new BasicStroke(2.1f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        for (int yy = y; yy < y + h; yy += 6) {
            for (int xx = x; xx < x + w; xx += 8) {
                float j = (r.nextFloat() - 0.5f) * 0.6f;
                g.setColor(Paint.c(Paint.shade(color, 1.22f + j * 0.2f), 150));
                g.draw(new Line2D.Float(xx + 1, yy + 1, xx + 4, yy + 5));
                g.draw(new Line2D.Float(xx + 7, yy + 1, xx + 4, yy + 5));
                g.setColor(new Color(0, 0, 0, 55));
                g.draw(new Line2D.Float(xx + 4, yy + 5.5f, xx + 4, yy + 6.2f));
            }
        }
    }

    /** Re-applies the stitch shading over a painted pattern so it looks knitted in. */
    private static void knitOverlay(Graphics2D g, int x, int y, int w, int h) {
        g.setStroke(new BasicStroke(1.4f));
        for (int yy = y; yy < y + h; yy += 6) {
            for (int xx = x; xx < x + w; xx += 8) {
                g.setColor(new Color(0, 0, 0, 36));
                g.draw(new Line2D.Float(xx + 4, yy + 5, xx + 4, yy + 6));
                g.draw(new Line2D.Float(xx, yy, xx + 1, yy + 1));
            }
        }
    }
}
