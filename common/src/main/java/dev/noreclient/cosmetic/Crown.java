package dev.noreclient.cosmetic;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RadialGradientPaint;
import java.awt.geom.Ellipse2D;
import java.awt.geom.QuadCurve2D;
import java.awt.image.BufferedImage;
import java.util.Random;

/**
 * "Korona" – an engraved metal crown with eight points, an orb on every point and four big cut gems
 * on the band, or a slim diadem with one tall jewel. It sits a little loose: it hops on landing,
 * tilts with the head's motion and, with glow on, the gems pulse and stars twinkle on the points.
 * Colour: the metal (gold, silver, rose gold…).
 */
final class Crown extends Item {
    private static final int SIDES = 32, POINTS = 8;
    private static final float R = 4.72f, BASE = -7.7f;
    private static final float[] METAL = {0f, 0f, 0.5f, 0.5f}, INNER = {0.5f, 0f, 1f, 0.5f}, ERMINE = {0.5f, 0.5f, 1f, 0.75f};
    private static final float[][] GEMS = {{0f, 0.5f, 0.125f, 0.75f}, {0.125f, 0.5f, 0.25f, 0.75f}, {0.25f, 0.5f, 0.375f, 0.75f}, {0.375f, 0.5f, 0.5f, 0.75f}};
    private static final float[] SPARK = {0.875f, 0.75f, 1f, 1f};

    Crown() {
        super("crown", "Korona", Slot.HAT, "Grawerowany metal • szlachetne kamienie");
        defaultColor = 0xF2C14E;
        palette = new int[]{0xF2C14E, 0xD8DCE6, 0xE8A090, 0x6E6A78, 0x9AD8F0, 0x2E2A3A};
        variants = new String[]{"royal", "diadem"};
        variantNames = new String[]{"Królewska", "Diadem"};
        glowOption = true;
        glowDefault = true;
        texW = 256;
        texH = 128;
    }

    private static float sq(float phi) {
        double c = Math.abs(Math.cos(phi)), s = Math.abs(Math.sin(phi));
        return (float) (1 / Math.pow(Math.pow(c, 5) + Math.pow(s, 5), 0.2));
    }

    private static float[] at(float phi, float r, float y) {
        float k = sq(phi) * r;
        return new float[]{(float) Math.cos(phi) * k, y, (float) Math.sin(phi) * k};
    }

    @Override
    protected void build(Build b) {
        Wearer w = b.w;
        float t = b.t;
        boolean diadem = "diadem".equals(b.variant());
        Mesh m = b.head();
        float hop = Math.max(0, -w.perk.x) * 0.12f - Math.max(0, w.bobY.x) * 0.3f;
        m.push();
        m.translate(0, BASE - hop, 0).rotateZ(w.bobX.x * 4).rotateX(-w.bobZ.x * 4 + (diadem ? -6 : 0)).scale(b.s);
        float h = diadem ? 1.1f : 2.2f;
        // band: outer and inner wall with a top rim
        for (int j = 0; j < SIDES; j++) {
            float p0 = (float) (j * Math.PI * 2 / SIDES), p1 = (float) ((j + 1) * Math.PI * 2 / SIDES);
            float u0 = METAL[0] + (METAL[2] - METAL[0]) * j / SIDES, u1 = METAL[0] + (METAL[2] - METAL[0]) * (j + 1) / SIDES;
            float[] a = at(p0, R, 0.3f), bb = at(p0, R, -h), c = at(p1, R, -h), d = at(p1, R, 0.3f);
            m.quad(new float[][]{a, bb, c, d}, new float[][]{{u0, 0.5f}, {u0, 0.12f}, {u1, 0.12f}, {u1, 0.5f}});
            float[] ia = at(p0, R - 0.35f, 0.3f), ib = at(p0, R - 0.35f, -h), ic = at(p1, R - 0.35f, -h), id = at(p1, R - 0.35f, 0.3f);
            m.quad(new float[][]{id, ic, ib, ia}, new float[][]{{u1, 0.5f}, {u1, 0.3f}, {u0, 0.3f}, {u0, 0.5f}});
            m.quad(new float[][]{bb, ib, ic, c}, new float[][]{{u0, 0.1f}, {u0, 0.12f}, {u1, 0.12f}, {u1, 0.1f}});
            // a raised moulding along the bottom
            float[] ma = at(p0, R + 0.25f, 0.3f), mb = at(p0, R + 0.25f, -0.35f), mc = at(p1, R + 0.25f, -0.35f), md = at(p1, R + 0.25f, 0.3f);
            m.quad(new float[][]{ma, mb, mc, md}, new float[][]{{u0, 0.05f}, {u0, 0.0f}, {u1, 0.0f}, {u1, 0.05f}});
            m.quad(new float[][]{mb, at(p0, R, -0.35f), at(p1, R, -0.35f), mc}, new float[][]{{u0, 0.05f}, {u0, 0.0f}, {u1, 0.0f}, {u1, 0.05f}});
        }
        Mesh g = b.glowHead();
        g.translate(0, BASE - hop, 0).rotateZ(w.bobX.x * 4).rotateX(-w.bobZ.x * 4 + (diadem ? -6 : 0)).scale(b.s);
        if (!diadem) {
            // eight points with an orb each
            for (int i = 0; i < POINTS; i++) {
                float phi = (float) (i * Math.PI * 2 / POINTS - Math.PI / 2);
                float tall = i % 2 == 0 ? 2.9f : 2.1f;
                float half = (float) (Math.PI / POINTS) * 0.78f;
                float[] l = at(phi - half, R, -h + 0.05f), r = at(phi + half, R, -h + 0.05f), tip = at(phi, R + 0.15f, -h - tall);
                float[] li = at(phi - half, R - 0.35f, -h + 0.05f), ri = at(phi + half, R - 0.35f, -h + 0.05f), tipi = at(phi, R - 0.2f, -h - tall);
                m.quad(new float[][]{l, tip, tip, r}, new float[][]{{0.05f, 0.3f}, {0.25f, 0.1f}, {0.25f, 0.1f}, {0.45f, 0.3f}});
                m.quad(new float[][]{ri, tipi, tipi, li}, new float[][]{{0.45f, 0.3f}, {0.25f, 0.1f}, {0.25f, 0.1f}, {0.05f, 0.3f}});
                m.quad(new float[][]{l, li, tipi, tip}, new float[][]{{0.05f, 0.3f}, {0.05f, 0.3f}, {0.25f, 0.1f}, {0.25f, 0.1f}});
                m.quad(new float[][]{r, tip, tipi, ri}, new float[][]{{0.45f, 0.3f}, {0.25f, 0.1f}, {0.25f, 0.1f}, {0.45f, 0.3f}});
                float[] orb = at(phi, R - 0.02f, -h - tall - 0.45f);
                float[] gem = i % 2 == 0 ? GEMS[3] : GEMS[(i / 2) % 3];
                m.sphere(orb[0], orb[1], orb[2], 0.5f, 0.5f, 0.5f, 4, 6, gem[0], gem[1], gem[2], gem[3]);
                // twinkle: a star flares on one point at a time
                float tw = (float) Math.max(0, Math.sin(t * 1.7f + i * 2.399f));
                tw = tw * tw * tw * tw;
                if (tw > 0.02f) {
                    g.push().translate(orb[0], orb[1], orb[2]).rotateY(t * 60 + i * 30).rotateZ(25);
                    g.star3(2.6f * tw, SPARK[0], SPARK[1], SPARK[2], SPARK[3]);
                    g.pop();
                }
            }
            // velvet cap with an ermine rim inside the crown
            float capTop = -h - 2.4f;
            for (int i = 0; i < 6; i++) {
                float s0 = i / 6f, s1 = (i + 1) / 6f;
                for (int j = 0; j < 16; j++) {
                    float p0 = (float) (j * Math.PI * 2 / 16), p1 = (float) ((j + 1) * Math.PI * 2 / 16);
                    float u0 = INNER[0] + (INNER[2] - INNER[0]) * j / 16f, u1 = INNER[0] + (INNER[2] - INNER[0]) * (j + 1) / 16f;
                    m.quad(new float[][]{cap(p0, s0, h, capTop), cap(p0, s1, h, capTop), cap(p1, s1, h, capTop), cap(p1, s0, h, capTop)},
                            new float[][]{{u0, INNER[3] - 0.4f * s0}, {u0, INNER[3] - 0.4f * s1}, {u1, INNER[3] - 0.4f * s1}, {u1, INNER[3] - 0.4f * s0}});
                }
            }
            for (int j = 0; j < SIDES; j++) {
                float p0 = (float) (j * Math.PI * 2 / SIDES), p1 = (float) ((j + 1) * Math.PI * 2 / SIDES);
                float u0 = ERMINE[0] + (ERMINE[2] - ERMINE[0]) * j / SIDES, u1 = ERMINE[0] + (ERMINE[2] - ERMINE[0]) * (j + 1) / SIDES;
                m.quad(new float[][]{at(p0, R - 0.3f, -h + 0.3f), at(p0, R - 0.75f, -h - 0.5f), at(p1, R - 0.75f, -h - 0.5f), at(p1, R - 0.3f, -h + 0.3f)},
                        new float[][]{{u0, ERMINE[3]}, {u0, ERMINE[1]}, {u1, ERMINE[1]}, {u1, ERMINE[3]}});
            }
            // cross on top
            m.box(-0.22f, capTop - 2.2f, -0.22f, 0.22f, capTop + 0.2f, 0.22f, 0.1f, 0.15f, 0.4f, 0.3f);
            m.box(-0.8f, capTop - 1.6f, -0.2f, 0.8f, capTop - 1.15f, 0.2f, 0.1f, 0.15f, 0.4f, 0.3f);
        } else {
            // diadem: one tall jewel in front
            float phi = (float) (-Math.PI / 2);
            float[] l = at(phi - 0.32f, R, -h + 0.05f), r = at(phi + 0.32f, R, -h + 0.05f), tip = at(phi, R + 0.1f, -h - 3.4f);
            m.quad(new float[][]{l, tip, tip, r}, new float[][]{{0.05f, 0.3f}, {0.25f, 0.1f}, {0.25f, 0.1f}, {0.45f, 0.3f}});
            float[] li = at(phi - 0.32f, R - 0.3f, -h + 0.05f), ri = at(phi + 0.32f, R - 0.3f, -h + 0.05f), ti = at(phi, R - 0.2f, -h - 3.4f);
            m.quad(new float[][]{ri, ti, ti, li}, new float[][]{{0.45f, 0.3f}, {0.25f, 0.1f}, {0.25f, 0.1f}, {0.05f, 0.3f}});
            float[] jewel = at(phi, R + 0.35f, -h - 1.4f);
            m.sphere(jewel[0], jewel[1], jewel[2], 0.9f, 1.15f, 0.45f, 5, 8, GEMS[1][0], GEMS[1][1], GEMS[1][2], GEMS[1][3]);
            float tw = 0.5f + 0.5f * (float) Math.sin(t * 2.2f);
            g.push().translate(jewel[0], jewel[1], jewel[2] - 0.5f).rotateY(t * 50).rotateZ(25);
            g.star3(2.4f * tw * tw + 0.4f, SPARK[0], SPARK[1], SPARK[2], SPARK[3]);
            g.pop();
        }
        // four cut gems on the band (front, back, sides)
        for (int i = 0; i < 4; i++) {
            float phi = (float) (i * Math.PI / 2 - Math.PI / 2);
            float[] p = at(phi, R + 0.28f, -h / 2f + 0.1f);
            float[] gem = GEMS[i % 3];
            float gs = diadem ? 0.45f : 0.75f;
            m.push().translate(p[0], p[1], p[2]).rotateY((float) Math.toDegrees(-phi) + 90);
            m.sphere(0, 0, 0, gs, gs * 1.1f, gs * 0.45f, 4, 8, gem[0], gem[1], gem[2], gem[3]);
            m.pop();
            float pulse = 0.55f + 0.45f * (float) Math.sin(t * 2.6f + i * 1.7f);
            int a = (int) (255 * pulse);
            g.color(a << 24 | a << 16 | a << 8 | a);
            g.push().translate(p[0], p[1], p[2]).rotateY((float) Math.toDegrees(-phi) + 90);
            g.sphere(0, 0, -0.05f, gs * 1.05f, gs * 1.15f, gs * 0.5f, 4, 8, gem[0], gem[1], gem[2], gem[3]);
            g.pop();
            g.color(-1);
        }
        m.pop();
    }

    private static float[] cap(float phi, float s, float h, float top) {
        double th = s * Math.PI / 2;
        float r = (R - 0.6f) * (float) Math.cos(th);
        float y = -h + 0.4f + (top - (-h + 0.4f)) * (float) Math.sin(th);
        float k = (1 + (sq(phi) - 1) * (1 - s));
        return new float[]{(float) Math.cos(phi) * r * k, y, (float) Math.sin(phi) * r * k};
    }

    @Override
    protected float topY(Worn w) { return -7.7f - (("diadem".equals(w.variant) ? 4.5f : 7.6f) * w.scale); }

    @Override
    protected float[] previewFrame() { return new float[]{0, -11, 0, 13}; }

    // ---------------------------------------------------------------- texture (256x128)

    @Override
    protected BufferedImage paint(int color, String variant) { return texture(color, false); }

    @Override
    protected BufferedImage paintGlow(int color, String variant) { return texture(color, true); }

    private static final int[] GEM_COLORS = {0xE0203C, 0x2E6BFF, 0x1EC07A, 0xE8F6FF};

    private static BufferedImage texture(int color, boolean mask) {
        BufferedImage img = Paint.image(256, 128);
        Graphics2D g = Paint.g(img);
        if (mask) {
            g.setColor(Color.BLACK);
            g.fillRect(0, 0, 256, 128);
            // faint sheen on the metal, bright gems and the sparkle sprite
            g.setPaint(new GradientPaint(0, 0, Paint.c(color, 40), 0, 64, Paint.c(color, 8)));
            g.fillRect(0, 0, 128, 64);
            for (int i = 0; i < 4; i++) gem(g, i * 32, 64, GEM_COLORS[i], true);
            Paint.glow(g, 240, 112, 15, Paint.mix(color, 0xFFFFFF, 0.6f), 230);
            Paint.sparkle(g, 240, 112, 15, 0xFFFFFF, 255);
            g.dispose();
            return img;
        }
        // metal: polished gradient, engraved scrolls and dotted borders
        g.setPaint(new GradientPaint(0, 0, Paint.c(Paint.shade(color, 1.35f)), 0, 64, Paint.c(Paint.shade(color, 0.55f))));
        g.fillRect(0, 0, 128, 64);
        g.setPaint(new GradientPaint(0, 16, new Color(255, 255, 255, 110), 0, 28, new Color(255, 255, 255, 0)));
        g.fillRect(0, 14, 128, 14);
        g.setStroke(new BasicStroke(1.3f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(Paint.c(Paint.shade(color, 0.45f), 160));
        for (int x = 0; x < 128; x += 16) {
            g.draw(new QuadCurve2D.Float(x, 46, x + 4, 36, x + 8, 44));
            g.draw(new QuadCurve2D.Float(x + 8, 44, x + 12, 52, x + 16, 46));
        }
        g.setColor(Paint.c(Paint.shade(color, 1.6f), 200));
        for (int x = 2; x < 128; x += 5) {
            g.fill(new Ellipse2D.Float(x, 58, 2.2f, 2.2f));
            g.fill(new Ellipse2D.Float(x, 33, 2f, 2f));
        }
        Paint.speckle(g, 0, 0, 128, 64, 300, 3, 0xFFFFFF, 0);
        // velvet
        g.setPaint(new RadialGradientPaint(192, 70, 90, new float[]{0, 1}, new Color[]{new Color(0x9A1838), new Color(0x3A0614)}));
        g.fillRect(128, 0, 128, 64);
        Paint.speckle(g, 128, 0, 128, 64, 900, 4, 0xFF8090, 0);
        // gems: faceted with a highlight
        for (int i = 0; i < 4; i++) gem(g, i * 32, 64, GEM_COLORS[i], false);
        // ermine: white fur with black tails
        g.setColor(new Color(0xF4F0E8));
        g.fillRect(128, 64, 128, 32);
        Paint.fur(g, 128, 64, 128, 32, 0xF4F0E8, 1, 0.2f, 6, 300, 6);
        g.setColor(new Color(0x15121A));
        for (int i = 0; i < 6; i++) {
            float x = 136 + i * 21;
            g.fill(new java.awt.Polygon(new int[]{(int) x, (int) x + 3, (int) x + 6}, new int[]{72, 86, 72}, 3));
        }
        g.dispose();
        return img;
    }

    private static void gem(Graphics2D g, int x, int y, int c, boolean mask) {
        Random r = new Random(c);
        if (mask) {
            g.setPaint(new RadialGradientPaint(x + 16, y + 16, 18, new float[]{0, 1}, new Color[]{Paint.c(Paint.shade(c, 1.4f), 255), Paint.c(c, 120)}));
            g.fillRect(x, y, 32, 32);
            return;
        }
        g.setPaint(new RadialGradientPaint(x + 12, y + 10, 26, new float[]{0, 0.5f, 1}, new Color[]{Paint.c(Paint.shade(c, 1.7f)), Paint.c(c), Paint.c(Paint.shade(c, 0.35f))}));
        g.fillRect(x, y, 32, 32);
        g.setStroke(new BasicStroke(1f));
        for (int i = 0; i < 6; i++) {
            g.setColor(new Color(255, 255, 255, 30 + r.nextInt(50)));
            g.drawLine(x + 16, y + 16, x + r.nextInt(32), y + (i % 2 == 0 ? 0 : 31));
        }
        Paint.sparkle(g, x + 10, y + 9, 5, 0xFFFFFF, 220);
    }
}
