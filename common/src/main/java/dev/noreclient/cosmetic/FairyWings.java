package dev.noreclient.cosmetic;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RadialGradientPaint;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.QuadCurve2D;
import java.awt.image.BufferedImage;
import java.util.Random;

/**
 * "Skrzydła Wróżki" – two pairs of thin, patterned wings (a butterfly or an iridescent fairy):
 * a lazy flutter while standing, a fast shimmering beat when flying, pressed together when
 * sneaking, swept back when running. With glow on the veins light up and a trail of sparkles
 * drifts down behind them.
 */
final class FairyWings extends Item {
    private static final float UP_W = 10.5f, UP_H = 11f, LO_W = 7.5f, LO_H = 8f;

    FairyWings() {
        super("fairy_wings", "Skrzydła Wróżki", Slot.WINGS, "Trzepoczą jak motyl • brokatowy pył");
        defaultColor = 0x8A5CFF;
        palette = new int[]{0x8A5CFF, 0xFF8A1F, 0x3CC8E0, 0xFF6FB5, 0x5BD68A, 0xFFD54A};
        variants = new String[]{"fairy", "butterfly"};
        variantNames = new String[]{"Wróżka", "Motyl"};
        glowOption = true;
        glowDefault = true;
        texW = 512;
        texH = 256;
    }

    @Override
    protected void build(Build b) {
        Wearer w = b.w;
        float t = b.t;
        float flight = Math.min(1, w.flight + Math.max(0, w.perk.x) * 0.08f);
        float tuck = Math.min(1, w.sneak + w.swim * 0.7f);
        float trail = w.speed * (1 - flight);
        float slow = (float) Math.sin(t * Math.PI * 2 * 0.7), fast = (float) Math.sin(t * Math.PI * 2 * 7.5);
        // occasional double flap while idle, like a resting butterfly
        float flick = (float) Math.max(0, Math.sin(t * 1.3)) * (float) Math.max(0, Math.sin(t * 9));
        float open = mix(26 + 10 * slow + 22 * flick * w.idle, 14 + 34 * (0.5f + 0.5f * fast), flight);
        open = mix(open, 78, tuck) + trail * 22;
        Mesh m = b.body();
        m.translate(0, 3.6f, 2.15f).scale(b.s);
        for (int side = 0; side < 2; side++) {
            m.push();
            if (side == 1) m.scale(-1, 1, 1);
            float lag = flight * 6 * (float) Math.sin(t * Math.PI * 2 * 7.5 - 0.9);
            m.translate(0.4f, 0, 0.1f);
            // upper wing: tilted up and out
            m.push().rotateY(-open).rotateZ(-14 - 4 * slow * (1 - flight)).rotateX(-6);
            m.plane(0, -UP_H + 2, UP_W, 2, 0, 0, 0.5f, 1);
            m.pop();
            // lower wing: hangs down and out, a beat behind
            m.push().translate(0, 1.2f, 0.05f).rotateY(-open - lag - 6).rotateZ(26 + 3 * slow).rotateX(4);
            m.plane(0, -1, LO_W, LO_H - 1, 0.5f, 0, 1, 1);
            m.pop();
            m.pop();
        }
        // sparkle dust drifting down behind the wings (glow only)
        Mesh g = b.glowBody();
        g.translate(0, 3.6f, 2.15f).scale(b.s);
        for (int i = 0; i < 10; i++) {
            float life = (t * 0.55f + i * 0.137f) % 1f;
            float sideX = (i % 2 == 0 ? 1 : -1) * (4 + (i * 37 % 7));
            float x = sideX * (1 - life * 0.3f), y = -6 + (i * 53 % 9) + life * 14, z = 3 + life * 3 + (i % 3);
            float size = 1.3f * (float) Math.sin(life * Math.PI) * (0.6f + 0.4f * (float) Math.sin(t * 6 + i));
            if (size <= 0.05f) continue;
            g.push().translate(x, y, z).rotateY(t * 90 + i * 40).rotateX(i * 25);
            g.star3(size, 0.9375f, 0.875f, 1f, 1f);
            g.pop();
        }
    }

    private static float mix(float a, float b, float t) { return a + (b - a) * t; }

    @Override
    protected float[] previewFrame() { return new float[]{0, -6, 6, 24}; }

    // ---------------------------------------------------------------- texture (512x256)

    @Override
    protected BufferedImage paint(int color, String variant) { return texture(color, "butterfly".equals(variant), false); }

    @Override
    protected BufferedImage paintGlow(int color, String variant) { return texture(color, "butterfly".equals(variant), true); }

    /** Upper wing in the left half (hinge at the bottom left), lower wing in the right half (hinge at the top left). */
    private static Path2D upper() {
        Path2D p = new Path2D.Float();
        // plane spans x 0..UP_W, y -UP_H+2..2 → texture 256 x 256; hinge near (0, 210)
        p.moveTo(6, 214);
        p.curveTo(10, 120, 60, 18, 150, 10);
        p.curveTo(222, 4, 252, 40, 246, 86);
        p.curveTo(240, 140, 170, 196, 90, 226);
        p.curveTo(50, 240, 14, 236, 6, 214);
        p.closePath();
        return p;
    }

    private static Path2D lower() {
        Path2D p = new Path2D.Float();
        // plane x 0..LO_W, y -1..LO_H-1 → hinge near (0, 32)
        p.moveTo(256 + 8, 20);
        p.curveTo(256 + 90, 14, 256 + 220, 60, 256 + 236, 140);
        p.curveTo(256 + 246, 200, 256 + 200, 248, 256 + 150, 238);
        p.curveTo(256 + 90, 226, 256 + 30, 150, 256 + 6, 60);
        p.closePath();
        return p;
    }

    private static BufferedImage texture(int color, boolean butterfly, boolean mask) {
        BufferedImage img = Paint.image(512, 256);
        Graphics2D g = Paint.g(img);
        if (mask) {
            g.setColor(Color.BLACK);
            g.fillRect(0, 0, 512, 256);
        }
        paintWing(g, upper(), 6, 214, color, butterfly, mask, 3);
        paintWing(g, lower(), 256 + 8, 24, color, butterfly, mask, 5);
        if (mask) {
            // sparkle sprite (bottom-right corner, only ever sampled by the glow pass)
            g.setColor(Color.BLACK);
            g.fillRect(480, 224, 32, 32);
            Paint.glow(g, 496, 240, 15, Paint.mix(color, 0xFFFFFF, 0.6f), 200);
            Paint.sparkle(g, 496, 240, 14, 0xFFFFFF, 255);
        }
        g.dispose();
        return img;
    }

    private static void paintWing(Graphics2D g, Path2D shape, float hx, float hy, int color, boolean butterfly, boolean mask, long seed) {
        Random r = new Random(seed);
        java.awt.Rectangle bb = shape.getBounds();
        g.setClip(shape);
        int light = Paint.shade(color, 1.55f), dark = Paint.shade(color, 0.35f);
        if (!mask) {
            if (butterfly) {
                g.setPaint(new RadialGradientPaint(hx, hy, 240, new float[]{0, 0.5f, 1}, new Color[]{Paint.c(Paint.shade(color, 0.7f)), Paint.c(color), Paint.c(light)}));
                g.fill(bb);
            } else {
                // iridescent: colour shifting into a neighbouring hue, pale towards the edge
                float[] hsb = Color.RGBtoHSB((color >> 16) & 255, (color >> 8) & 255, color & 255, null);
                int shifted = Color.HSBtoRGB(hsb[0] + 0.12f, Math.max(0.3f, hsb[1] * 0.8f), Math.min(1, hsb[2] * 1.1f + 0.1f)) & 0xFFFFFF;
                g.setPaint(new RadialGradientPaint(hx, hy, 250, new float[]{0, 0.55f, 1}, new Color[]{Paint.c(light, 230), Paint.c(color, 210), Paint.c(shifted, 200)}));
                g.fill(bb);
                g.setPaint(new GradientPaint(bb.x, bb.y, new Color(255, 255, 255, 60), bb.x + bb.width, bb.y + bb.height, new Color(255, 255, 255, 0)));
                g.fill(bb);
            }
            Paint.speckle(g, bb.x, bb.y, bb.width, bb.height, 900, seed, 0xFFFFFF, dark);
        }
        // veins fanning out from the hinge
        int veinCol = butterfly ? 0x14100C : Paint.mix(color, 0xFFFFFF, 0.7f);
        g.setStroke(new BasicStroke(butterfly ? 4.5f : 2.4f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(mask ? Paint.c(Paint.mix(color, 0xFFFFFF, 0.5f), butterfly ? 70 : 190) : Paint.c(veinCol, butterfly ? 235 : 150));
        for (int i = 0; i < 7; i++) {
            double a = Math.atan2((bb.y + bb.height / 2f) - hy, (bb.x + bb.width / 2f) - hx) + (i - 3) * 0.26;
            float len = 300;
            float ex = hx + (float) Math.cos(a) * len, ey = hy + (float) Math.sin(a) * len;
            g.draw(new QuadCurve2D.Float(hx, hy, (hx + ex) / 2f + (float) Math.sin(a) * 20, (hy + ey) / 2f - (float) Math.cos(a) * 20, ex, ey));
        }
        // the edge: a dark border with white spots (butterfly) or a bright glassy rim (fairy)
        if (butterfly) {
            g.setStroke(new BasicStroke(26f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.setColor(mask ? new Color(0, 0, 0) : new Color(0x16110D));
            g.draw(shape);
            java.awt.geom.PathIterator it = shape.getPathIterator(null, 2);
            float[] pt = new float[6];
            int k = 0;
            while (!it.isDone()) {
                it.currentSegment(pt);
                if (k++ % 3 == 0) {
                    float sz = 3 + r.nextFloat() * 3;
                    g.setColor(mask ? Paint.c(0xFFFFFF, 170) : new Color(0xFFF6E8));
                    g.fill(new Ellipse2D.Float(pt[0] - sz + (hx - pt[0]) * 0.03f, pt[1] - sz + (hy - pt[1]) * 0.03f, sz * 2, sz * 2));
                }
                it.next();
            }
            if (!mask) {
                g.setColor(Paint.c(Paint.shade(color, 1.3f), 120));
                g.fill(new Ellipse2D.Float(bb.x + bb.width * 0.55f, bb.y + bb.height * 0.3f, 26, 20));
            }
        } else {
            g.setStroke(new BasicStroke(9f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.setColor(mask ? Paint.c(Paint.mix(color, 0xFFFFFF, 0.6f), 210) : Paint.c(Paint.mix(color, 0xFFFFFF, 0.75f), 230));
            g.draw(shape);
            for (int i = 0; i < 14; i++) {
                float x = bb.x + r.nextFloat() * bb.width, y = bb.y + r.nextFloat() * bb.height;
                if (!shape.contains(x, y)) continue;
                Paint.sparkle(g, x, y, 3 + r.nextFloat() * 4, 0xFFFFFF, mask ? 230 : 170);
            }
        }
        g.setClip(null);
        if (!mask) {
            g.setColor(new Color(0, 0, 0, 90));
            g.setStroke(new BasicStroke(1.5f));
            g.draw(shape);
        }
    }
}
