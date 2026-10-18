package dev.noreclient.cosmetic;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RadialGradientPaint;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.Rectangle2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.util.Random;

/**
 * "Kapelusz Wiedźmy" – the Halloween hat: a soft, crooked witch hat with a wavy brim, a pumpkin-orange
 * band with a golden buckle and patched, stitched felt. Smooth geometry (rings along a bent spine):
 * the tip lags behind head turns and movement like a real floppy cone, bounces on landing and the
 * brim flutters while running. Colour: the felt; glow: the stars and the stitched seam.
 */
final class WitchHat extends Item {
    private static final int SIDES = 22, RINGS = 13;
    private static final float BASE_Y = -8.65f, CROWN_R = 4.95f, CROWN_LEN = 15.5f, BRIM_R = 8.9f;

    WitchHat() {
        super("witch_hat", "Kapelusz Wiedźmy", Slot.HAT, "Halloween • miękki filc z łatkami");
        defaultColor = 0x2E1444;
        palette = new int[]{0x2E1444, 0x1A1A22, 0x123A2A, 0x4A0E14, 0x14284A, 0x5A3A24};
        variants = new String[]{"classic", "starry"};
        variantNames = new String[]{"Klasyczny", "Gwiezdny"};
        glowOption = true;
        glowDefault = false;
        texW = texH = 512;
    }

    /** Spine point and lean angle at s (0 = base, 1 = tip): back lean plus a sideways bend. */
    private static float[][] spine(float back, float sideBend) {
        float[][] out = new float[RINGS + 1][4];
        float y = BASE_Y - 0.2f, z = 0.3f;
        float ds = CROWN_LEN / RINGS;
        for (int i = 0; i <= RINGS; i++) {
            float s = i / (float) RINGS;
            float lean = (float) Math.toRadians(7 + 78 * Math.pow(s, 2.6) + back * 22 * s * s);
            out[i][0] = y;
            out[i][1] = z;
            out[i][2] = lean;
            out[i][3] = sideBend * 3.2f * s * s;
            y -= Math.cos(lean) * ds;
            z += Math.sin(lean) * ds;
        }
        return out;
    }

    private static float radius(float s, float phi) {
        float r = (float) (CROWN_R * Math.pow(1 - s, 1.08) + 0.22f);
        // crumpled felt: gentle lobes that drift up the cone
        return r * (1 + 0.045f * (float) Math.sin(phi * 3 + s * 5.5f) + 0.02f * (float) Math.sin(phi * 5 - s * 3));
    }

    private static float[] ring(float[] sp, float r, float phi) {
        float lean = sp[2];
        // ring plane spanned by X and the spine normal (0, sin, cos)
        float cx = (float) Math.cos(phi) * r, cn = (float) Math.sin(phi) * r;
        return new float[]{cx + sp[3], sp[0] + cn * (float) Math.sin(lean), sp[1] + cn * (float) Math.cos(lean)};
    }

    @Override
    protected void build(Build b) {
        Wearer w = b.w;
        float time = b.t, motion = w.speed;
        float back = motion * (0.6f + 0.4f * (float) Math.sin(time * 9)) + 0.08f * (float) Math.sin(time * 1.7)
                + w.bobZ.x * 0.9f - w.bobY.x * 0.4f + w.flight * 0.5f;
        float sideBend = -w.bobX.x * 1.4f + 0.15f * (float) Math.sin(time * 1.3);
        float[][] sp = spine(back, sideBend);
        Mesh m = b.head();
        m.push();
        m.translate(0, BASE_Y, 0).scale(b.s).translate(0, -BASE_Y, 0);
        // ---- crown
        for (int i = 0; i < RINGS; i++) {
            float s0 = i / (float) RINGS, s1 = (i + 1) / (float) RINGS;
            for (int j = 0; j < SIDES; j++) {
                float p0 = (float) (j * Math.PI * 2 / SIDES), p1 = (float) ((j + 1) * Math.PI * 2 / SIDES);
                float u0 = j / (float) SIDES, u1 = (j + 1) / (float) SIDES;
                float v0 = 0.5f * (1 - s0), v1 = 0.5f * (1 - s1);
                m.quad(new float[][]{ring(sp[i], radius(s0, p0), p0), ring(sp[i + 1], radius(s1, p0), p0),
                                ring(sp[i + 1], radius(s1, p1), p1), ring(sp[i], radius(s0, p1), p1)},
                        new float[][]{{u0, v0}, {u0, v1}, {u1, v1}, {u1, v0}});
            }
        }
        // ---- band (a slightly wider sleeve over the first rings)
        int bandRings = 2;
        for (int i = 0; i < bandRings; i++) {
            float s0 = i / (float) RINGS, s1 = (i + 1) / (float) RINGS;
            for (int j = 0; j < SIDES; j++) {
                float p0 = (float) (j * Math.PI * 2 / SIDES), p1 = (float) ((j + 1) * Math.PI * 2 / SIDES);
                float u0 = 0.5f + 0.5f * j / SIDES, u1 = 0.5f + 0.5f * (j + 1) / SIDES;
                float v0 = 0.5f + 0.125f * (1 - i / (float) bandRings), v1 = 0.5f + 0.125f * (1 - (i + 1) / (float) bandRings);
                float g = 0.32f;
                m.quad(new float[][]{ring(sp[i], radius(s0, p0) + g, p0), ring(sp[i + 1], radius(s1, p0) + g, p0),
                                ring(sp[i + 1], radius(s1, p1) + g, p1), ring(sp[i], radius(s0, p1) + g, p1)},
                        new float[][]{{u0, v0}, {u0, v1}, {u1, v1}, {u1, v0}});
            }
        }
        // ---- buckle on the front of the band (front = -z, phi = -90°)
        float[] mid = sp[1];
        float bandFront = radius(0.5f / RINGS, (float) -Math.PI / 2) + 0.45f;
        m.push().translate(0, (sp[0][0] + mid[0]) / 2f, (sp[0][1] + mid[1]) / 2f).rotateX(-(float) Math.toDegrees(sp[0][2]));
        float bu0 = 0.5f, bv0 = 0.625f, bu1 = 0.625f, bv1 = 0.75f, t = 0.5f;
        m.box(-1.6f, -1.25f, -bandFront - t, -1.0f, 1.25f, -bandFront + 0.2f, bu0, bv0, bu1, bv1);
        m.box(1.0f, -1.25f, -bandFront - t, 1.6f, 1.25f, -bandFront + 0.2f, bu0, bv0, bu1, bv1);
        m.box(-1.0f, -1.25f, -bandFront - t, 1.0f, -0.7f, -bandFront + 0.2f, bu0, bv0, bu1, bv1);
        m.box(-1.0f, 0.7f, -bandFront - t, 1.0f, 1.25f, -bandFront + 0.2f, bu0, bv0, bu1, bv1);
        m.box(-0.15f, -0.7f, -bandFront - t * 0.7f, 0.15f, 0.7f, -bandFront + 0.2f, bu0, bv0, bu1, bv1);
        m.pop();
        // ---- brim: wavy disc, top and underside, with a rolled edge; flutters when moving
        int rs = 5, as = 30;
        float flutter = Math.min(1, motion + Math.abs(w.bobY.x) * 0.8f);
        float[][][] top = new float[rs + 1][as + 1][];
        for (int i = 0; i <= rs; i++) {
            for (int j = 0; j <= as; j++) {
                float r = BRIM_R * i / rs, a = (float) (j * Math.PI * 2 / as);
                float k = r / BRIM_R;
                float droop = k * k * (1.15f + 0.45f * (float) Math.sin(a * 3 + 0.6f) + 0.25f * (float) Math.sin(a * 5 + time * 2.2f) * flutter);
                // the brim tips down a touch at the front and rises at the back
                droop += k * k * 0.5f * (float) -Math.sin(a) + k * k * w.bobY.x * 0.8f;
                top[i][j] = new float[]{(float) Math.cos(a) * r, BASE_Y + droop, (float) Math.sin(a) * r + 0.3f * k};
            }
        }
        float thick = 0.45f;
        for (int i = 0; i < rs; i++) {
            for (int j = 0; j < as; j++) {
                float[] a = top[i][j], bb = top[i + 1][j], c = top[i + 1][j + 1], d = top[i][j + 1];
                m.quad(new float[][]{a, d, c, bb}, new float[][]{brimUv(a, 0), brimUv(d, 0), brimUv(c, 0), brimUv(bb, 0)});
                m.quad(new float[][]{down(a, thick), down(bb, thick), down(c, thick), down(d, thick)},
                        new float[][]{brimUv(a, 1), brimUv(bb, 1), brimUv(c, 1), brimUv(d, 1)});
            }
        }
        for (int j = 0; j < as; j++) {
            float[] a = top[rs][j], bb = top[rs][j + 1];
            float u0 = 0.625f + 0.375f * j / as, u1 = 0.625f + 0.375f * (j + 1) / as;
            m.quad(new float[][]{a, down(a, thick), down(bb, thick), bb}, new float[][]{{u0, 0.69f}, {u0, 0.74f}, {u1, 0.74f}, {u1, 0.69f}});
        }
        m.pop();
    }

    @Override
    protected float topY(Worn w) { return -21f * w.scale - 8.65f * (1 - w.scale); }

    @Override
    protected float[] previewFrame() { return new float[]{0, -16, 0, 22}; }

    private static float[] down(float[] p, float d) { return new float[]{p[0], p[1] + d, p[2]}; }

    private static float[] brimUv(float[] p, int side) {
        float u = (p[0] / BRIM_R + 1) / 2f, v = (p[2] / BRIM_R + 1) / 2f;
        u = Math.max(0, Math.min(1, u));
        v = Math.max(0, Math.min(1, v));
        return side == 0 ? new float[]{u * 0.5f, 0.5f + v * 0.5f} : new float[]{0.5f + u * 0.5f, 0.75f + v * 0.25f};
    }

    // ---------------------------------------------------------------- texture (512x512)

    @Override
    protected BufferedImage paint(int color, String variant) { return texture(color, "starry".equals(variant), false); }

    @Override
    protected BufferedImage paintGlow(int color, String variant) { return texture(color, "starry".equals(variant), true); }

    static BufferedImage texture(int color, boolean starry, boolean mask) {
        int s = 512;
        BufferedImage img = Paint.image(s, s);
        Graphics2D g = Paint.g(img);
        if (mask) {
            g.setColor(Color.BLACK);
            g.fillRect(0, 0, s, s);
        }
        crown(g, 512, 256, color, starry, mask);
        if (mask) {
            g.dispose();
            return img;
        }
        g.translate(256, 256);
        band(g, 256, 64);
        g.translate(0, 64);
        buckle(g, 64, 64);
        g.translate(64, 0);
        g.setPaint(new GradientPaint(0, 0, Paint.c(Paint.shade(color, 0.9f)), 0, 64, Paint.c(Paint.shade(color, 0.4f))));
        g.fillRect(0, 0, 192, 64);
        g.setColor(new Color(255, 138, 31, 120));
        g.fill(new Rectangle2D.Float(0, 34, 192, 3));
        g.translate(-320, -64);
        brimTop(g, 256, color);
        g.translate(256, 128);
        g.setPaint(new GradientPaint(0, 0, Paint.c(Paint.shade(color, 0.28f)), 0, 128, Paint.c(Paint.shade(color, 0.55f))));
        g.fillRect(0, 0, 256, 128);
        g.dispose();
        return img;
    }

    /** Felt: woven speckle, soft folds, two stitched patches, a spiral seam and glinting stars. */
    private static void crown(Graphics2D g, int w, int h, int color, boolean starry, boolean mask) {
        Random r = new Random(31);
        if (!mask) {
            g.setPaint(new GradientPaint(0, h, Paint.c(color), 0, 0, Paint.c(Paint.shade(color, 0.42f))));
            g.fillRect(0, 0, w, h);
            // folds: soft vertical bands, periodic so the seam at u = 0/1 is invisible
            int fold = Paint.shade(color, 2.2f);
            for (int x = 0; x < w; x++) {
                double f = Math.sin(x * Math.PI * 2 * 3 / w) * 0.6 + Math.sin(x * Math.PI * 2 * 7 / w + 1) * 0.4;
                int a = (int) (Math.abs(f) * 34);
                g.setColor(f > 0 ? Paint.c(fold, a / 2) : new Color(0, 0, 0, a));
                g.fillRect(x, 0, 1, h);
            }
            int speck = Paint.shade(color, 2.4f);
            for (int i = 0; i < 2600; i++) {
                int x = r.nextInt(w), y = r.nextInt(h);
                g.setColor(r.nextBoolean() ? Paint.c(speck, 14 + r.nextInt(18)) : new Color(0, 0, 0, 30 + r.nextInt(30)));
                g.fillRect(x, y, 1 + r.nextInt(2), 1);
            }
            patch(g, 74, 128, 70, 52, -0.12, Paint.c(Paint.shade(color, 1.35f)), Paint.c(Paint.shade(color, 0.95f)));
            patch(g, 330, 70, 48, 40, 0.18, new Color(0x5A2A1A), new Color(0x3C1A10));
        } else {
            r.nextInt();
        }
        // a stitched seam winding up the cone
        g.setStroke(new BasicStroke(2.2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND, 1f, new float[]{7, 6}, 0));
        g.setColor(mask ? new Color(255, 140, 50, 150) : new Color(255, 150, 60, 110));
        Path2D seam = new Path2D.Float();
        seam.moveTo(0, h - 40);
        for (int x = 0; x <= w; x += 8) seam.lineTo(x, h - 40 - x * 0.32 + Math.sin(x * 0.05) * 4);
        g.draw(seam);
        // stars near the tip (and all over the starry variant, with a crescent moon)
        Random sr = new Random(9);
        int stars = starry ? 34 : 9;
        for (int i = 0; i < stars; i++) {
            float x = 20 + sr.nextFloat() * (w - 40), y = 10 + sr.nextFloat() * (starry ? h - 40 : 90);
            star(g, x, y, 3 + sr.nextFloat() * (starry ? 4 : 3), mask);
        }
        if (starry) {
            g.setColor(mask ? new Color(0xFFD27A) : new Color(0xFFE7A8));
            Path2D moon = new Path2D.Float(Path2D.WIND_EVEN_ODD);
            moon.append(new Ellipse2D.Float(180, 120, 44, 44), false);
            moon.append(new Ellipse2D.Float(194, 112, 44, 44), false);
            java.awt.geom.Area a = new java.awt.geom.Area(new Ellipse2D.Float(180, 120, 44, 44));
            a.subtract(new java.awt.geom.Area(new Ellipse2D.Float(194, 112, 44, 44)));
            g.fill(a);
        }
    }

    private static void patch(Graphics2D g, float x, float y, float w, float h, double rot, Color c, Color dark) {
        java.awt.geom.AffineTransform old = g.getTransform();
        g.rotate(rot, x + w / 2, y + h / 2);
        g.setPaint(new GradientPaint(x, y, c, x, y + h, dark));
        g.fill(new RoundRectangle2D.Float(x, y, w, h, 8, 8));
        g.setColor(new Color(0, 0, 0, 90));
        g.setStroke(new BasicStroke(2f));
        g.draw(new RoundRectangle2D.Float(x, y, w, h, 8, 8));
        g.setColor(new Color(0xFFB24A));
        g.setStroke(new BasicStroke(2.4f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND, 1f, new float[]{5, 5}, 0));
        g.draw(new RoundRectangle2D.Float(x + 5, y + 5, w - 10, h - 10, 6, 6));
        // cross stitches on the corners
        g.setStroke(new BasicStroke(2.2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        float[][] corners = {{x, y}, {x + w, y}, {x, y + h}, {x + w, y + h}};
        for (float[] k : corners) {
            g.draw(new java.awt.geom.Line2D.Float(k[0] - 5, k[1] - 5, k[0] + 5, k[1] + 5));
            g.draw(new java.awt.geom.Line2D.Float(k[0] - 5, k[1] + 5, k[0] + 5, k[1] - 5));
        }
        g.setTransform(old);
    }

    private static void star(Graphics2D g, float x, float y, float r, boolean mask) {
        g.setPaint(new RadialGradientPaint(x, y, r * 3, new float[]{0, 1}, new Color[]{new Color(255, 200, 110, mask ? 150 : 90), new Color(255, 200, 110, 0)}));
        g.fill(new Ellipse2D.Float(x - r * 3, y - r * 3, r * 6, r * 6));
        Path2D p = new Path2D.Float();
        for (int i = 0; i < 8; i++) {
            double a = i * Math.PI / 4, rr = i % 2 == 0 ? r : r * 0.35;
            if (i == 0) p.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            else p.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        p.closePath();
        g.setColor(new Color(0xFFE7A8));
        g.fill(p);
    }

    /** Pumpkin-orange band with little bats and darker hems. */
    private static void band(Graphics2D g, int w, int h) {
        g.setPaint(new GradientPaint(0, 0, new Color(0xFFA238), 0, h, new Color(0xC24E0B)));
        g.fillRect(0, 0, w, h);
        g.setColor(new Color(0x5A1A04));
        g.fillRect(0, 0, w, 7);
        g.fillRect(0, h - 7, w, 7);
        g.setColor(new Color(255, 230, 170, 120));
        g.fillRect(0, 7, w, 2);
        for (int i = 0; i < 4; i++) {
            float cx = 32 + i * 64, cy = h / 2f;
            Path2D bat = new Path2D.Float();
            bat.moveTo(cx - 18, cy - 4);
            bat.quadTo(cx - 12, cy - 9, cx - 5, cy - 3);
            bat.lineTo(cx - 3, cy - 8);
            bat.lineTo(cx, cy - 5);
            bat.lineTo(cx + 3, cy - 8);
            bat.lineTo(cx + 5, cy - 3);
            bat.quadTo(cx + 12, cy - 9, cx + 18, cy - 4);
            bat.quadTo(cx + 13, cy - 1, cx + 13, cy + 4);
            bat.quadTo(cx + 9, cy + 1, cx + 6, cy + 5);
            bat.quadTo(cx + 3, cy + 2, cx, cy + 7);
            bat.quadTo(cx - 3, cy + 2, cx - 6, cy + 5);
            bat.quadTo(cx - 9, cy + 1, cx - 13, cy + 4);
            bat.quadTo(cx - 13, cy - 1, cx - 18, cy - 4);
            g.setColor(new Color(0x2A0E06));
            g.fill(bat);
        }
    }

    private static void buckle(Graphics2D g, int w, int h) {
        g.setPaint(new GradientPaint(0, 0, new Color(0xFFF0B0), w, h, new Color(0xA8740A)));
        g.fillRect(0, 0, w, h);
        g.setColor(new Color(255, 255, 255, 140));
        g.fillRect(4, 4, w - 8, 6);
        g.setColor(new Color(90, 50, 0, 120));
        g.fillRect(0, h - 8, w, 8);
    }

    /** Brim seen from above: darker towards the crown, a stitched ring and a lighter rolled edge. */
    private static void brimTop(Graphics2D g, int s, int color) {
        float c = s / 2f;
        g.setPaint(new RadialGradientPaint(c, c, c, new float[]{0, 0.55f, 0.92f, 1f},
                new Color[]{Paint.c(Paint.shade(color, 0.3f)), Paint.c(Paint.shade(color, 0.72f)), Paint.c(Paint.shade(color, 1.1f)), Paint.c(Paint.shade(color, 0.55f))}));
        g.fillRect(0, 0, s, s);
        Random r = new Random(7);
        int speck = Paint.shade(color, 2.4f);
        for (int i = 0; i < 1400; i++) {
            g.setColor(Paint.c(speck, 10 + r.nextInt(16)));
            g.fillRect(r.nextInt(s), r.nextInt(s), 1 + r.nextInt(2), 1);
        }
        g.setColor(new Color(0xFFB24A));
        g.setStroke(new BasicStroke(2.6f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND, 1f, new float[]{6, 6}, 0));
        float rr = c * 0.84f;
        g.draw(new Ellipse2D.Float(c - rr, c - rr, rr * 2, rr * 2));
    }
}
