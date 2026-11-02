package dev.noreclient.cosmetic;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.geom.Path2D;
import java.awt.image.BufferedImage;

/**
 * Tails: a smooth tube along a spine that is bent every frame. They trail and lift when the player
 * runs, droop when sneaking, swing sideways behind turns, bounce on landing and wag (fox), flick
 * the tip in a question mark (cat) or curl in a lazy S with a spade tip (devil) while idle.
 */
final class Tails extends Item {
    private static final int FOX = 0, CAT = 1, DEVIL = 2;
    private final int kind;

    private Tails(String id, String name, String desc, int kind) {
        super(id, name, Slot.TAIL, desc);
        this.kind = kind;
        texW = 128;
        texH = 256;
        if (kind == FOX) {
            secret = true;
            defaultColor = 0xE8732A;
            palette = new int[]{0xE8732A, 0xA8461E, 0xF2EFE8, 0x8A8E9A, 0x2E2A2E, 0xD9A05B};
            variants = new String[]{"classic", "fluffy"};
            variantNames = new String[]{"Klasyczny", "Puszysty"};
        } else if (kind == CAT) {
            secret = true;
            defaultColor = 0x2A262C;
            palette = new int[]{0x2A262C, 0xF4F1EC, 0xE8913E, 0x8E8C94, 0xE6D2AE, 0x7A5638};
            variants = new String[]{"plain", "tabby"};
            variantNames = new String[]{"Gładki", "Pręgowany"};
        } else {
            defaultColor = 0xB0182A;
            palette = new int[]{0xB0182A, 0x2A1A2E, 0x5A1A8A, 0x1A1A1A, 0xE8732A, 0x1E6A4A};
            glowOption = true;
            glowDefault = false;
        }
    }

    static Tails fox() { return new Tails("fox_tail", "Ogon Lisa", "Sekret • merda, gdy stoisz", FOX); }

    static Tails cat() { return new Tails("cat_tail", "Ogon Kota", "Sekret • znak zapytania na końcu", CAT); }

    static Tails devil() { return new Tails("devil_tail", "Ogon Diabełka", "Halloween • grot na końcu, leniwe S", DEVIL); }

    @Override
    protected void build(Build b) {
        Wearer w = b.w;
        float t = b.t;
        int n = kind == FOX ? 13 : 15;
        float len = kind == FOX ? 13f : kind == CAT ? 13.5f : 12.5f;
        float lift = w.tailLift.x, sideS = w.tailSide.x;
        float happy = w.idle * (1 - w.sneak);
        float[][] sp = new float[n][];
        float[] rad = new float[n];
        float x = 0, y = 0, z = 0;
        float seg = len / (n - 1);
        for (int i = 0; i < n; i++) {
            float f = i / (n - 1f);
            float pitch, yaw;
            if (kind == FOX) {
                // hangs back and down, the tip curving up; wags wide and slow while idle
                float p0 = -48 + lift * 46 - w.sneak * 14;
                pitch = p0 + 42 * f * f;
                float wag = happy * 26 * (float) Math.sin(t * 7.2f - f * 2.4f) + 6 * (float) Math.sin(t * 1.3f - f * 1.6f);
                yaw = sideS * 46 * f + wag * f;
            } else if (kind == CAT) {
                // down when standing, raised when walking, low when sneaking; the tip curls and flicks
                float walk = Math.min(1, w.speed * 2.2f) * (1 - w.sneak);
                float p0 = -70 + walk * 105 + lift * 25 - w.sneak * 10;
                float curl = (1 - w.sneak) * (60 + 70 * happy);
                pitch = p0 + curl * (float) Math.pow(f, 2.2) + w.sneak * 10 * f;
                float flick = (float) Math.sin(t * 3.1f - f * 3) * (10 + 22 * happy) * f * f;
                yaw = sideS * 50 * f + flick + 8 * (float) Math.sin(t * 0.9f) * f;
            } else {
                // a slow S-curve travelling down the tail
                float p0 = -40 + lift * 40 - w.sneak * 20;
                pitch = p0 + 70 * f + 10 * (float) Math.sin(t * 2.1f - f * 4);
                yaw = sideS * 40 * f + 34 * (float) Math.sin(t * 1.7f - f * 3.6f) * f;
            }
            if (i > 0) {
                double pr = Math.toRadians(pitch), yr = Math.toRadians(yaw);
                x += (float) (Math.sin(yr) * Math.cos(pr)) * seg;
                y += (float) -Math.sin(pr) * seg;
                z += (float) (Math.cos(yr) * Math.cos(pr)) * seg;
            }
            sp[i] = new float[]{x, y, z};
            if (kind == FOX) {
                boolean fluffy = "fluffy".equals(b.variant());
                float bulge = (float) Math.sin(Math.PI * Math.pow(f, 0.75));
                rad[i] = 0.75f + (fluffy ? 2.15f : 1.75f) * bulge * (f > 0.9f ? (1 - f) / 0.1f * 0.7f + 0.3f : 1);
            } else if (kind == CAT) {
                rad[i] = 0.62f - 0.18f * f * f;
            } else {
                rad[i] = 0.42f - 0.12f * f;
            }
        }
        Mesh m = b.body();
        m.translate(0, 10.6f, 1.6f).scale(b.s);
        int sides = kind == FOX ? 12 : 8;
        m.tube(sp, rad, sides, 0, 0, 0.75f, 1);
        float[] e = sp[n - 1], p = sp[n - 2];
        float[] dir = {e[0] - p[0], e[1] - p[1], e[2] - p[2]};
        if (kind == DEVIL) {
            // spade: two crossed diamond planes at the tip
            float[] d = Mesh.norm(dir);
            float yawD = (float) Math.toDegrees(Math.atan2(d[0], d[2]));
            float pitchD = (float) Math.toDegrees(Math.asin(-d[1]));
            m.push().translate(e[0], e[1], e[2]).rotateY(yawD).rotateX(90 + pitchD);
            spade(m);
            m.push().rotateY(90);
            spade(m);
            m.pop();
            m.pop();
        } else {
            m.cap(e, dir, rad[n - 1], sides, 0.375f, 0.99f);
        }
        m.cap(sp[0], new float[]{sp[0][0] - sp[1][0], sp[0][1] - sp[1][1], sp[0][2] - sp[1][2]}, rad[0], sides, 0.375f, 0.02f);
    }

    /** Spade in the local XY plane, root at the top, point down +y (rotated so +y continues the tail). */
    private static void spade(Mesh m) {
        float u0 = 0.75f, u1 = 1f, v0 = 0f, v1 = 0.25f;
        m.plane(-1.5f, -0.4f, 1.5f, 2.9f, u0, v0, u1, v1);
    }

    @Override
    protected float[] previewFrame() { return new float[]{0, 12, 7, 17}; }

    // ---------------------------------------------------------------- texture (128x256)

    @Override
    protected BufferedImage paint(int color, String variant) { return texture(color, variant, false); }

    @Override
    protected BufferedImage paintGlow(int color, String variant) { return texture(color, variant, true); }

    private BufferedImage texture(int color, String variant, boolean mask) {
        BufferedImage img = Paint.image(128, 256);
        Graphics2D g = Paint.g(img);
        // tube: u 0..96 around (the middle, u ≈ 48, is the underside), v 0 (root) .. 256 (tip)
        if (mask) {
            g.setColor(Color.BLACK);
            g.fillRect(0, 0, 128, 256);
            g.setPaint(new GradientPaint(0, 0, Paint.c(color, 0), 0, 256, Paint.c(Paint.shade(color, 1.5f), 160)));
            g.fillRect(0, 0, 96, 256);
            spadeSprite(g, color, true);
            g.dispose();
            return img;
        }
        int under = kind == FOX ? Paint.mix(color, 0xFFF4E4, 0.55f) : Paint.shade(color, 1.12f);
        for (int x = 0; x < 96; x++) {
            float k = (float) (0.5 - 0.5 * Math.cos(x / 96.0 * Math.PI * 2)); // 1 at the underside
            g.setColor(Paint.c(Paint.mix(color, under, k * (kind == FOX ? 0.7f : 0.35f))));
            g.fillRect(x, 0, 1, 256);
        }
        g.setPaint(new GradientPaint(0, 0, new Color(0, 0, 0, 50), 0, 60, new Color(0, 0, 0, 0)));
        g.fillRect(0, 0, 96, 60);
        if (kind == FOX) {
            // the white tip, feathered into the fur
            int tip = Paint.luma(color) > 0.75f ? 0x2A2428 : 0xFBF7F0;
            g.setPaint(new GradientPaint(0, 186, Paint.c(tip, 0), 0, 214, Paint.c(tip, 255)));
            g.fillRect(0, 186, 96, 70);
            Paint.fur(g, 0, 0, 96, 256, color, 0, 1, 14, 1500, 31);
            Paint.fur(g, 0, 190, 96, 66, tip, 0, 1, 12, 300, 32);
        } else if (kind == CAT) {
            if ("tabby".equals(variant)) {
                g.setColor(Paint.c(Paint.shade(color, Paint.luma(color) > 0.6f ? 0.7f : 0.5f), 220));
                for (int i = 0; i < 8; i++) g.fillRect(0, 20 + i * 30, 96, 11);
            }
            Paint.fur(g, 0, 0, 96, 256, color, 0, 1, 7, 900, 33);
        } else {
            // devil: glossy, with a highlight line and small scales
            g.setPaint(new GradientPaint(30, 0, new Color(255, 255, 255, 0), 40, 0, new Color(255, 255, 255, 70), true));
            g.fillRect(0, 0, 96, 256);
            g.setColor(new Color(0, 0, 0, 45));
            for (int yy = 0; yy < 256; yy += 8) for (int xx = (yy / 8) % 2 * 6; xx < 96; xx += 12) g.drawArc(xx, yy, 12, 10, 200, 140);
            spadeSprite(g, color, false);
        }
        g.dispose();
        return img;
    }

    /** Spade tip sprite (u 96..128, v 0..64): root at the top, point at the bottom. */
    private static void spadeSprite(Graphics2D g, int color, boolean mask) {
        Path2D p = new Path2D.Float();
        float cx = 112;
        p.moveTo(cx, 6);
        p.curveTo(cx + 18, 22, cx + 16, 40, cx + 4, 44);
        p.lineTo(cx, 62);
        p.lineTo(cx - 4, 44);
        p.curveTo(cx - 16, 40, cx - 18, 22, cx, 6);
        p.closePath();
        if (mask) {
            g.setColor(Paint.c(Paint.shade(color, 1.6f), 220));
            g.setStroke(new BasicStroke(3f));
            g.draw(p);
            return;
        }
        g.setPaint(new GradientPaint(96, 0, Paint.c(Paint.shade(color, 1.25f)), 128, 64, Paint.c(Paint.shade(color, 0.5f))));
        g.fill(p);
        g.setColor(new Color(0, 0, 0, 120));
        g.setStroke(new BasicStroke(1.5f));
        g.draw(p);
        g.setColor(new Color(255, 255, 255, 90));
        g.draw(new java.awt.geom.Line2D.Float(cx, 10, cx, 52));
    }
}
