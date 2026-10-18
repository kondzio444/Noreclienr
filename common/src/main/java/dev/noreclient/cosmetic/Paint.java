package dev.noreclient.cosmetic;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RadialGradientPaint;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.QuadCurve2D;
import java.awt.image.BufferedImage;
import java.util.Random;

/** Small painting helpers shared by the procedural item textures. */
final class Paint {
    private Paint() {}

    static BufferedImage image(int w, int h) { return new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB); }

    static Graphics2D g(BufferedImage img) {
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        return g;
    }

    static Color c(int rgb) { return new Color(rgb & 0xFFFFFF); }

    static Color c(int rgb, int alpha) { return new Color((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, Math.max(0, Math.min(255, alpha))); }

    /** Mix of two RGB colours (t = 0 → a). */
    static int mix(int a, int b, float t) {
        t = Math.max(0, Math.min(1, t));
        int r = (int) (((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t));
        int g = (int) (((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t));
        int bl = (int) ((a & 255) + (((b & 255) - (a & 255)) * t));
        return r << 16 | g << 8 | bl;
    }

    /** Darker (f < 1) or lighter (f > 1) towards white. */
    static int shade(int rgb, float f) {
        if (f <= 1) return mix(0, rgb, f);
        return mix(rgb, 0xFFFFFF, f - 1);
    }

    /** Relative brightness 0..1. */
    static float luma(int rgb) {
        return (0.299f * ((rgb >> 16) & 255) + 0.587f * ((rgb >> 8) & 255) + 0.114f * (rgb & 255)) / 255f;
    }

    /** Fine speckle noise over a rectangle. */
    static void speckle(Graphics2D g, int x, int y, int w, int h, int count, long seed, int light, int dark) {
        Random r = new Random(seed);
        for (int i = 0; i < count; i++) {
            g.setColor(r.nextBoolean() ? c(light, 8 + r.nextInt(18)) : c(dark, 18 + r.nextInt(30)));
            g.fillRect(x + r.nextInt(Math.max(1, w)), y + r.nextInt(Math.max(1, h)), 1 + r.nextInt(2), 1);
        }
    }

    /** Fur: many short curved strands along a direction (dx, dy), lighter and darker than the base. */
    static void fur(Graphics2D g, int x, int y, int w, int h, int base, float dx, float dy, float len, int count, long seed) {
        Random r = new Random(seed);
        g.setStroke(new BasicStroke(1.2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        for (int i = 0; i < count; i++) {
            float px = x + r.nextFloat() * w, py = y + r.nextFloat() * h;
            float l = len * (0.6f + r.nextFloat() * 0.8f);
            float bend = (r.nextFloat() - 0.5f) * l * 0.5f;
            boolean light = r.nextFloat() < 0.45f;
            g.setColor(c(shade(base, light ? 1.25f + r.nextFloat() * 0.2f : 0.6f + r.nextFloat() * 0.25f), 70 + r.nextInt(90)));
            g.draw(new QuadCurve2D.Float(px, py, px + dx * l * 0.5f - dy * bend, py + dy * l * 0.5f + dx * bend, px + dx * l, py + dy * l));
        }
    }

    /** Soft round glow spot. */
    static void glow(Graphics2D g, float x, float y, float r, int rgb, int alpha) {
        g.setPaint(new RadialGradientPaint(x, y, Math.max(0.5f, r), new float[]{0f, 1f}, new Color[]{c(rgb, alpha), c(rgb, 0)}));
        g.fill(new Ellipse2D.Float(x - r, y - r, r * 2, r * 2));
    }

    /** Four-pointed sparkle star. */
    static void sparkle(Graphics2D g, float x, float y, float r, int rgb, int alpha) {
        Path2D p = new Path2D.Float();
        for (int i = 0; i < 8; i++) {
            double a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 == 0 ? r : r * 0.28;
            if (i == 0) p.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            else p.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        p.closePath();
        g.setColor(c(rgb, alpha));
        g.fill(p);
    }

    /** Five-pointed star. */
    static Path2D star5(float x, float y, float r, float inner) {
        Path2D p = new Path2D.Float();
        for (int i = 0; i < 10; i++) {
            double a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 == 0 ? r : r * inner;
            if (i == 0) p.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            else p.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        p.closePath();
        return p;
    }

    /** Six-armed snowflake. */
    static void snowflake(Graphics2D g, float x, float y, float r, int rgb, int alpha, float width) {
        g.setColor(c(rgb, alpha));
        g.setStroke(new BasicStroke(width, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        for (int i = 0; i < 6; i++) {
            double a = i * Math.PI / 3;
            float ex = x + (float) Math.cos(a) * r, ey = y + (float) Math.sin(a) * r;
            g.draw(new java.awt.geom.Line2D.Float(x, y, ex, ey));
            for (int k = 1; k <= 2; k++) {
                float bx = x + (float) Math.cos(a) * r * (0.35f + 0.25f * k), by = y + (float) Math.sin(a) * r * (0.35f + 0.25f * k);
                float bl = r * (0.34f - 0.08f * k);
                for (int sgn = -1; sgn <= 1; sgn += 2) {
                    double b = a + sgn * Math.PI / 4;
                    g.draw(new java.awt.geom.Line2D.Float(bx, by, bx + (float) Math.cos(b) * bl, by + (float) Math.sin(b) * bl));
                }
            }
        }
    }
}
