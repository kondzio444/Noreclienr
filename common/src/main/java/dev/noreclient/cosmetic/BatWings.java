package dev.noreclient.cosmetic;

import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RadialGradientPaint;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.QuadCurve2D;
import java.awt.image.BufferedImage;
import java.util.Random;

/**
 * "Skrzydła Nietoperza" – Halloween bat wings on the player's back. Each wing is two membranes
 * (arm and fingers) hinged at the wrist with a 3D leading bone and a claw; they breathe slowly while
 * standing, tuck in when sneaking, trail back when running, beat when the player flies, glides or
 * falls and flap once on every jump. Colour: the membrane; glow: the ember rim and veins.
 */
final class BatWings extends Item {
    /** Texture: the whole wing at 512x256 (arm half | fingers half) and a bone swatch below it. */
    static final int TW = 512, TH = 288, WING_H = 256;
    private static final float W1 = 10f, W2 = 11.5f, Y0 = -9f, H = 12.5f;
    private static final float VMAX = WING_H / (float) TH;
    private static final float BU0 = 2f / TW, BV0 = (WING_H + 6f) / TH, BU1 = 28f / TW, BV1 = (TH - 6f) / TH;
    private static final float[][] LEAD_IN = {{0, 36}, {128, 14}, {256, 12}};
    private static final float[][] LEAD_OUT = {{256, 12}, {396, 30}, {500, 80}};
    private static final float[][] TIPS = {{500, 80}, {466, 186}, {374, 242}, {280, 250}};

    BatWings() {
        super("bat_wings", "Skrzydła Nietoperza", Slot.WINGS, "Halloween • błona z żarzącym się brzegiem");
        defaultColor = 0x4A1C62;
        palette = new int[]{0x4A1C62, 0x22222C, 0x7A1020, 0x1E3A5C, 0x2E4A1A, 0x6A4020};
        variants = new String[]{"classic", "tattered"};
        variantNames = new String[]{"Klasyczne", "Postrzępione"};
        glowOption = true;
        glowDefault = true;
        texW = TW;
        texH = TH;
    }

    @Override
    protected void build(Build b) {
        Wearer w = b.w;
        float time = b.t;
        // a flap on take-off, a crouch-in when sneaking, trailing back when running
        float flight = Math.min(1, w.flight + Math.max(0, w.perk.x) * 0.06f);
        float tuck = Math.min(1, w.sneak * 0.8f + w.swim * 0.6f);
        float trail = w.speed * (1 - flight) * 0.8f;
        double idle = time * Math.PI * 2 * 0.45, beat = time * Math.PI * 2 * 2.1;
        float spread = mix(30 + 5 * (float) Math.sin(idle), 18 + 36 * (0.5f + 0.5f * (float) Math.sin(beat)), flight);
        float lift = mix(14 + 3 * (float) Math.sin(idle + 0.6), 8 + 22 * (float) Math.sin(beat), flight);
        float fold = mix(26 + 7 * (float) Math.sin(idle - 0.9), 6 + 28 * (0.5f + 0.5f * (float) Math.sin(beat - 1.1)), flight);
        spread = mix(spread, 62, tuck) - trail * 14;
        fold = mix(fold, 70, tuck) + trail * 18;
        lift = lift - trail * 6 + w.perk.x * 1.5f;
        float sway = w.tailSide.x * 6;
        Mesh m = b.body();
        m.translate(0, 3.2f, 2.3f).scale(b.s);
        for (int side = 0; side < 2; side++) {
            m.push();
            if (side == 1) m.scale(-1, 1, 1);
            float sd = side == 0 ? sway : -sway;
            m.translate(1.2f, 0, 0.85f).rotateY(-spread - sd).rotateZ(-lift).rotateX(-6 - trail * 10);
            // arm membrane
            m.plane(0, Y0, W1, Y0 + H, 0, 0, 0.5f, VMAX);
            bones(m, LEAD_IN, 0, W1);
            // fingers membrane, hinged at the wrist
            m.translate(W1, 0, 0).rotateY(-fold);
            m.plane(0, Y0, W2, Y0 + H, 0.5f, 0, 1f, VMAX);
            bones(m, LEAD_OUT, 256, W2);
            // claw on the wrist
            float wy = Y0 + LEAD_OUT[0][1] / WING_H * H;
            m.push().translate(0, wy, 0).rotateZ(-62);
            m.box(-0.35f, -0.35f, -0.35f, 1.9f, 0.35f, 0.35f, BU0, BV0, BU1, BV1);
            m.translate(1.9f, 0, 0).rotateZ(-55);
            m.box(-0.25f, -0.25f, -0.25f, 0.9f, 0.25f, 0.25f, BU0, BV0, BU1, BV1);
            m.pop();
            m.pop();
        }
    }

    @Override
    protected float[] previewFrame() { return new float[]{0, -6, 6, 26}; }

    /** Leading-edge bone through three texture points (px), mapped onto a membrane of width w. */
    private static void bones(Mesh m, float[][] pts, float px0, float w) {
        for (int i = 0; i < pts.length - 1; i++) {
            float x0 = (pts[i][0] - px0) / 256f * w, y0 = Y0 + pts[i][1] / WING_H * H;
            float x1 = (pts[i + 1][0] - px0) / 256f * w, y1 = Y0 + pts[i + 1][1] / WING_H * H;
            float len = (float) Math.hypot(x1 - x0, y1 - y0);
            float th = i == 0 && px0 == 0 ? 0.55f : 0.42f;
            m.push().translate(x0, y0, 0).rotateZ((float) Math.toDegrees(Math.atan2(y1 - y0, x1 - x0)));
            m.box(-0.2f, -th, -th, len + 0.2f, th, th, BU0, BV0, BU1, BV1);
            m.pop();
        }
    }

    private static float mix(float a, float b, float t) { return a + (b - a) * t; }

    // ---------------------------------------------------------------- texture

    private static Path2D silhouette() {
        float wx = 256, wy = 12;
        Path2D p = new Path2D.Float();
        p.moveTo(0, 36);
        p.quadTo(128, -6, wx, wy);
        p.quadTo(396, 18, TIPS[0][0], TIPS[0][1]);
        for (int i = 0; i < TIPS.length - 1; i++) {
            float[] a = TIPS[i], b = TIPS[i + 1];
            float mx = (a[0] + b[0]) / 2f, my = (a[1] + b[1]) / 2f;
            p.quadTo(mx + (wx - mx) * 0.32f, my + (wy - my) * 0.32f, b[0], b[1]);
        }
        p.quadTo(150, 168, 0, 210);
        p.closePath();
        return p;
    }

    @Override
    protected BufferedImage paint(int color, String variant) { return texture(color, "tattered".equals(variant), false); }

    @Override
    protected BufferedImage paintGlow(int color, String variant) { return texture(color, "tattered".equals(variant), true); }

    static BufferedImage texture(int color, boolean tattered, boolean mask) {
        BufferedImage img = Paint.image(TW, TH);
        Graphics2D g = Paint.g(img);
        Path2D wing = silhouette();
        int rim = 0xFF8A1F;
        if (mask) {
            // glow mask: black membrane, bright rim, faint veins
            g.setClip(wing);
            g.setColor(Color.BLACK);
            g.fillRect(0, 0, TW, WING_H);
            veins(g, Paint.c(rim, 46));
            g.setStroke(new BasicStroke(12f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.setColor(Paint.c(rim, 120));
            g.draw(wing);
            g.setStroke(new BasicStroke(4f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.setColor(Paint.c(0xFFB050));
            g.draw(wing);
            g.setClip(null);
            g.setColor(Color.BLACK);
            g.fillRect(0, WING_H, TW, TH - WING_H);
            tears(g, tattered, true);
            g.dispose();
            return img;
        }
        g.setClip(wing);
        // membrane: lit around the bones, darker towards the trailing edge
        g.setPaint(new RadialGradientPaint(256, 12, 300, new float[]{0f, 0.45f, 1f},
                new Color[]{Paint.c(color), Paint.c(Paint.shade(color, 0.57f)), Paint.c(Paint.shade(color, 0.25f))}));
        g.fillRect(0, 0, TW, WING_H);
        g.setPaint(new RadialGradientPaint(60, 120, 170, new float[]{0f, 1f},
                new Color[]{new Color(255, 120, 40, 46), new Color(255, 120, 40, 0)}));
        g.fillRect(0, 0, TW, WING_H);
        Random r = new Random(13);
        int light = Paint.shade(color, 1.6f);
        for (int i = 0; i < 3200; i++) {
            g.setColor(r.nextBoolean() ? Paint.c(light, 10 + r.nextInt(14)) : new Color(0, 0, 0, 24 + r.nextInt(26)));
            g.fillRect(r.nextInt(TW), r.nextInt(WING_H), 1 + r.nextInt(2), 1);
        }
        veins(g, Paint.c(Paint.shade(color, 1.7f), 70));
        g.setClip(null);
        int bone = Paint.mix(0x1E0C18, Paint.shade(color, 0.3f), 0.5f);
        for (float[] t : TIPS) {
            g.setColor(Paint.c(bone));
            g.setStroke(new BasicStroke(7f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.draw(new QuadCurve2D.Float(256, 12, (256 + t[0]) / 2f + 6, (12 + t[1]) / 2f - 8, t[0], t[1]));
            g.setColor(Paint.c(Paint.shade(color, 1.5f), 150));
            g.setStroke(new BasicStroke(2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.draw(new QuadCurve2D.Float(255, 10, (256 + t[0]) / 2f + 5, (12 + t[1]) / 2f - 10, t[0], t[1] - 2));
        }
        // arm bone along the leading edge
        g.setColor(Paint.c(bone));
        g.setStroke(new BasicStroke(12f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.draw(new QuadCurve2D.Float(0, 40, 128, 2, 256, 14));
        g.draw(new QuadCurve2D.Float(256, 14, 396, 22, 500, 80));
        // ember rim on the trailing edge
        g.setClip(wing);
        g.setStroke(new BasicStroke(9f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(Paint.c(rim, 70));
        g.draw(wing);
        g.setStroke(new BasicStroke(3.4f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(Paint.c(rim));
        g.draw(wing);
        g.setClip(null);
        tears(g, tattered, false);
        // bone swatch for the 3D bones and claw
        g.setColor(Paint.c(Paint.mix(0x24101C, bone, 0.5f)));
        g.fillRect(0, WING_H, 32, TH - WING_H);
        g.setColor(Paint.c(Paint.shade(color, 1.25f)));
        g.fillRect(0, WING_H + 4, 32, 6);
        g.dispose();
        return img;
    }

    private static void veins(Graphics2D g, Color c) {
        g.setStroke(new BasicStroke(1.6f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(c);
        for (int i = 0; i < TIPS.length; i++) {
            for (int k = 1; k <= 3; k++) {
                float t = k / 4f;
                float bx = 256 + (TIPS[i][0] - 256) * t, by = 12 + (TIPS[i][1] - 12) * t;
                float nx = i < TIPS.length - 1 ? TIPS[i + 1][0] : 150, ny = i < TIPS.length - 1 ? TIPS[i + 1][1] : 190;
                g.draw(new QuadCurve2D.Float(bx, by, (bx + nx) / 2f + 10, (by + ny) / 2f - 14, bx + (nx - bx) * 0.45f, by + (ny - by) * 0.45f));
            }
        }
        for (int k = 0; k < 5; k++) {
            float y = 60 + k * 30;
            g.draw(new QuadCurve2D.Float(0, y, 90, y - 18 + k * 4, 200, y - 30 + k * 10));
        }
    }

    /** Holes in the membrane (a few more and ragged notches on the trailing edge for the tattered variant). */
    private static void tears(Graphics2D g, boolean tattered, boolean mask) {
        g.setComposite(AlphaComposite.Clear);
        Path2D tear = new Path2D.Float();
        tear.moveTo(410, 218);
        tear.lineTo(424, 204);
        tear.lineTo(420, 222);
        tear.closePath();
        g.fill(tear);
        g.fill(new Ellipse2D.Float(190, 176, 7, 5));
        if (tattered) {
            Random r = new Random(77);
            float[][] edge = {{470, 150}, {430, 214}, {330, 246}, {230, 200}, {120, 190}, {60, 204}, {300, 238}, {488, 120}};
            for (float[] e : edge) {
                Path2D n = new Path2D.Float();
                float s = 10 + r.nextFloat() * 12;
                n.moveTo(e[0] - s, e[1] + s);
                n.lineTo(e[0] + r.nextFloat() * 4 - 2, e[1] - s * (0.8f + r.nextFloat()));
                n.lineTo(e[0] + s, e[1] + s);
                n.closePath();
                g.fill(n);
            }
            g.fill(new Ellipse2D.Float(330, 150, 11, 7));
            g.fill(new Ellipse2D.Float(96, 120, 6, 9));
            g.fill(new Ellipse2D.Float(420, 120, 8, 6));
        }
        g.setComposite(AlphaComposite.SrcOver);
    }
}
