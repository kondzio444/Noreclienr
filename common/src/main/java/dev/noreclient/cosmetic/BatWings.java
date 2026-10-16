package dev.noreclient.cosmetic;

import java.awt.AlphaComposite;
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

/**
 * "Skrzydła Nietoperza" – Halloween bat wings on the player's back. Each wing is two membranes
 * (arm and fingers) hinged at the wrist with a 3D leading bone and a claw; they breathe slowly while
 * standing and beat when the player flies, glides or falls.
 */
final class BatWings {
    /** Texture: the whole wing at 512x256 (arm half | fingers half) and a bone swatch below it. */
    static final int TW = 512, TH = 288, WING_H = 256;
    private static final float W1 = 10f, W2 = 11.5f, Y0 = -9f, H = 12.5f;
    private static final float VMAX = WING_H / (float) TH;
    private static final float BU0 = 2f / TW, BV0 = (WING_H + 6f) / TH, BU1 = 28f / TW, BV1 = (TH - 6f) / TH;
    private static final float[][] LEAD_IN = {{0, 36}, {128, 14}, {256, 12}};
    private static final float[][] LEAD_OUT = {{256, 12}, {396, 30}, {500, 80}};

    private BatWings() {}

    /** time in seconds, flight 0 (standing) .. 1 (flying / gliding / falling). */
    static void build(Mesh m, float time, float flight) {
        double idle = time * Math.PI * 2 * 0.45, beat = time * Math.PI * 2 * 2.1;
        float spread = mix(30 + 5 * (float) Math.sin(idle), 18 + 36 * (0.5f + 0.5f * (float) Math.sin(beat)), flight);
        float lift = mix(14 + 3 * (float) Math.sin(idle + 0.6), 8 + 22 * (float) Math.sin(beat), flight);
        float fold = mix(26 + 7 * (float) Math.sin(idle - 0.9), 6 + 28 * (0.5f + 0.5f * (float) Math.sin(beat - 1.1)), flight);
        for (int side = 0; side < 2; side++) {
            m.push();
            if (side == 1) m.scale(-1, 1, 1);
            m.translate(1.2f, 3.2f, 3.15f).rotateY(-spread).rotateZ(-lift).rotateX(-6);
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
        float[][] tips = {{500, 80}, {466, 186}, {374, 242}, {280, 250}};
        float wx = 256, wy = 12;
        Path2D p = new Path2D.Float();
        p.moveTo(0, 36);
        p.quadTo(128, -6, wx, wy);
        p.quadTo(396, 18, tips[0][0], tips[0][1]);
        for (int i = 0; i < tips.length - 1; i++) {
            float[] a = tips[i], b = tips[i + 1];
            float mx = (a[0] + b[0]) / 2f, my = (a[1] + b[1]) / 2f;
            p.quadTo(mx + (wx - mx) * 0.32f, my + (wy - my) * 0.32f, b[0], b[1]);
        }
        p.quadTo(150, 168, 0, 210);
        p.closePath();
        return p;
    }

    static BufferedImage texture() {
        BufferedImage img = new BufferedImage(TW, TH, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        Path2D wing = silhouette();
        g.setClip(wing);
        // membrane: lit violet around the bones, night purple towards the trailing edge
        g.setPaint(new RadialGradientPaint(256, 12, 300, new float[]{0f, 0.45f, 1f},
                new Color[]{new Color(0x4A1C62), new Color(0x2A0F3C), new Color(0x12061C)}));
        g.fillRect(0, 0, TW, WING_H);
        g.setPaint(new RadialGradientPaint(60, 120, 170, new float[]{0f, 1f},
                new Color[]{new Color(255, 120, 40, 46), new Color(255, 120, 40, 0)}));
        g.fillRect(0, 0, TW, WING_H);
        Random r = new Random(13);
        for (int i = 0; i < 3200; i++) {
            g.setColor(r.nextBoolean() ? new Color(200, 150, 255, 10 + r.nextInt(14)) : new Color(0, 0, 0, 24 + r.nextInt(26)));
            g.fillRect(r.nextInt(TW), r.nextInt(WING_H), 1 + r.nextInt(2), 1);
        }
        // veins branching off the fingers
        float[][] tips = {{500, 80}, {466, 186}, {374, 242}, {280, 250}};
        g.setStroke(new BasicStroke(1.6f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        for (int i = 0; i < tips.length; i++) {
            for (int k = 1; k <= 3; k++) {
                float t = k / 4f;
                float bx = 256 + (tips[i][0] - 256) * t, by = 12 + (tips[i][1] - 12) * t;
                float nx = i < tips.length - 1 ? tips[i + 1][0] : 150, ny = i < tips.length - 1 ? tips[i + 1][1] : 190;
                g.setColor(new Color(150, 80, 190, 70));
                g.draw(new QuadCurve2D.Float(bx, by, (bx + nx) / 2f + 10, (by + ny) / 2f - 14, bx + (nx - bx) * 0.45f, by + (ny - by) * 0.45f));
            }
        }
        for (int k = 0; k < 5; k++) {
            float y = 60 + k * 30;
            g.setColor(new Color(150, 80, 190, 60));
            g.draw(new QuadCurve2D.Float(0, y, 90, y - 18 + k * 4, 200, y - 30 + k * 10));
        }
        g.setClip(null);
        // finger bones from the wrist
        for (float[] t : tips) {
            g.setColor(new Color(0x1E0C18));
            g.setStroke(new BasicStroke(7f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.draw(new QuadCurve2D.Float(256, 12, (256 + t[0]) / 2f + 6, (12 + t[1]) / 2f - 8, t[0], t[1]));
            g.setColor(new Color(110, 60, 90, 160));
            g.setStroke(new BasicStroke(2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g.draw(new QuadCurve2D.Float(255, 10, (256 + t[0]) / 2f + 5, (12 + t[1]) / 2f - 10, t[0], t[1] - 2));
        }
        // arm bone along the leading edge
        g.setColor(new Color(0x1E0C18));
        g.setStroke(new BasicStroke(12f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.draw(new QuadCurve2D.Float(0, 40, 128, 2, 256, 14));
        g.draw(new QuadCurve2D.Float(256, 14, 396, 22, 500, 80));
        // glowing ember rim on the trailing edge
        g.setClip(wing);
        g.setStroke(new BasicStroke(9f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(new Color(255, 120, 30, 70));
        g.draw(wing);
        g.setStroke(new BasicStroke(3.4f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(new Color(0xFF8A1F));
        g.draw(wing);
        g.setClip(null);
        // a small tear in the membrane
        g.setComposite(AlphaComposite.Clear);
        Path2D tear = new Path2D.Float();
        tear.moveTo(410, 218);
        tear.lineTo(424, 204);
        tear.lineTo(420, 222);
        tear.closePath();
        g.fill(tear);
        g.fill(new Ellipse2D.Float(190, 176, 7, 5));
        g.setComposite(AlphaComposite.SrcOver);
        // bone swatch for the 3D bones and claw
        g.setColor(new Color(0x24101C));
        g.fillRect(0, WING_H, 32, TH - WING_H);
        g.setColor(new Color(0x5A2E46));
        g.fillRect(0, WING_H + 4, 32, 6);
        g.dispose();
        return img;
    }
}
