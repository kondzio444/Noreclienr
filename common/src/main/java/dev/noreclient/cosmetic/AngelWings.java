package dev.noreclient.cosmetic;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.geom.Line2D;
import java.awt.geom.Path2D;
import java.awt.image.BufferedImage;
import java.util.Random;

/**
 * "Skrzydła Anioła" – big feathered wings: a two-part bone (arm and hand) carrying three layers of
 * single feathers (long fanned primaries on the hand, secondaries along the arm, short coverts on
 * top). Folded and breathing when standing, every feather ruffles a little; tucked tight when
 * sneaking, trailing when running, wide powerful beats with the primaries fanning open on the
 * downstroke when flying, and one flap on every jump. Colour: the feathers; glow: a holy rim light.
 */
final class AngelWings extends Item {
    private static final float ARM = 7.5f, HAND = 6.5f;
    // texture columns (u) of the three feather sprites and the bone swatch
    private static final float[] PRIM = {0f, 0.25f}, SEC = {0.25f, 0.5f}, COV = {0.5f, 0.75f};
    private static final float BU0 = 0.78f, BU1 = 0.97f, BV0 = 0.05f, BV1 = 0.3f;

    AngelWings() {
        super("angel_wings", "Skrzydła Anioła", Slot.WINGS, "Pióro po piórze • rozkładają się do lotu");
        defaultColor = 0xF4F1EA;
        palette = new int[]{0xF4F1EA, 0x2A2630, 0xF2C46A, 0xF7B8D2, 0x9FD4FF, 0xB39DDB};
        variants = new String[]{"classic", "gold_tips"};
        variantNames = new String[]{"Klasyczne", "Złote końcówki"};
        glowOption = true;
        glowDefault = false;
        texW = texH = 256;
    }

    @Override
    protected void build(Build b) {
        Wearer w = b.w;
        float t = b.t;
        float flight = Math.min(1, w.flight + Math.max(0, w.perk.x) * 0.07f);
        float tuck = Math.min(1, w.sneak * 0.9f + w.swim * 0.7f);
        float trail = w.speed * (1 - flight);
        double breath = t * Math.PI * 2 * 0.32, beat = t * Math.PI * 2 * 1.45;
        float down = 0.5f + 0.5f * (float) Math.sin(beat);
        // resting: folded behind the back; flying: wide beats with the hand lagging behind the arm
        float spread = mix(46 + 3 * (float) Math.sin(breath), 12 + 30 * (1 - down), flight);
        float lift = mix(28 + 3 * (float) Math.sin(breath + 0.8), -18 + 58 * (float) Math.sin(beat), flight);
        float fold = mix(62 + 4 * (float) Math.sin(breath - 0.5), 4 + 26 * (0.5f + 0.5f * (float) Math.sin(beat - 1.2)), flight);
        float fan = mix(0.55f, 0.75f + 0.35f * down, flight);
        spread = mix(spread, 70, tuck) + trail * 10;
        lift = mix(lift, 38, tuck) - trail * 12 + w.perk.x * 1.8f;
        fold = mix(fold, 92, tuck) + trail * 8;
        fan = mix(fan, 0.3f, tuck);
        float sway = w.tailSide.x * 5;
        Mesh m = b.body();
        m.translate(0, 2.6f, 2.25f).scale(b.s);
        for (int side = 0; side < 2; side++) {
            float sd = side == 0 ? sway : -sway;
            m.push();
            if (side == 1) m.scale(-1, 1, 1);
            m.translate(1.4f, 0, 0.5f).rotateY(-spread - sd).rotateZ(-lift).rotateX(-8 - trail * 8);
            // arm bone
            bone(m, ARM, 0.55f);
            // secondaries along the arm
            int ns = 6;
            for (int k = 0; k < ns; k++) {
                float x = 1.0f + k * (ARM - 1.0f) / ns;
                float ang = 16 - k * 2.5f + ruffle(t, k, side);
                feather(m, x, 0.2f, 0.06f + k * 0.015f, ang, 2.6f, 8.2f + k * 0.25f, SEC);
            }
            // coverts over the arm
            for (int k = 0; k < 7; k++) {
                float x = 0.4f + k * (ARM - 0.4f) / 7f;
                feather(m, x, -0.2f, 0.22f + k * 0.012f, 12 - k * 1.5f + ruffle(t, k + 9, side) * 0.5f, 2.2f, 4.6f, COV);
            }
            // hand, hinged at the wrist
            m.push();
            m.translate(ARM, 0, 0).rotateY(-fold).rotateZ(6 * flight * (float) Math.sin(beat - 0.6));
            bone(m, HAND, 0.42f);
            int np = 7;
            for (int k = 0; k < np; k++) {
                float f = k / (np - 1f);
                float x = 0.3f + f * (HAND - 0.6f);
                float ang = mix(14, -72, f) * fan + ruffle(t, k + 20, side);
                feather(m, x, 0.15f, 0.02f + k * 0.018f, ang, 2.4f, 9.4f + 2.6f * (float) Math.sin(f * Math.PI * 0.85), PRIM);
            }
            for (int k = 0; k < 5; k++) {
                float f = k / 4f;
                feather(m, 0.2f + f * (HAND - 1.2f), -0.25f, 0.24f + k * 0.012f, mix(10, -50, f) * fan, 2.0f, 4.2f, COV);
            }
            m.pop();
            m.pop();
        }
    }

    private static float ruffle(float t, int k, int side) {
        return 2.2f * (float) Math.sin(t * 2.3f + k * 1.7f + side * 0.9f);
    }

    /** One feather plane hanging from the bone at x: rotated in the wing plane by ang (degrees). */
    private static void feather(Mesh m, float x, float y, float z, float ang, float w, float len, float[] col) {
        m.push().translate(x, y, z).rotateZ(ang).rotateX(-4);
        m.plane(-w / 2, -0.3f, w / 2, len, col[0], 0, col[1], 1);
        m.pop();
    }

    private static void bone(Mesh m, float len, float th) {
        m.box(-0.3f, -th, -th * 0.8f, len + 0.3f, th, th * 0.8f, BU0, BV0, BU1, BV1);
    }

    private static float mix(float a, float b, float t) { return a + (b - a) * t; }

    @Override
    protected float[] previewFrame() { return new float[]{0, -6, 6, 30}; }

    // ---------------------------------------------------------------- texture (256x256)

    @Override
    protected BufferedImage paint(int color, String variant) { return texture(color, "gold_tips".equals(variant), false); }

    @Override
    protected BufferedImage paintGlow(int color, String variant) { return texture(color, "gold_tips".equals(variant), true); }

    private static BufferedImage texture(int color, boolean gold, boolean mask) {
        BufferedImage img = Paint.image(256, 256);
        Graphics2D g = Paint.g(img);
        if (mask) {
            g.setColor(Color.BLACK);
            g.fillRect(0, 0, 256, 256);
        }
        featherSprite(g, 0, 64, 256, color, gold, mask, 0.36f, 11);
        featherSprite(g, 64, 64, 256, color, gold, mask, 0.46f, 23);
        featherSprite(g, 128, 64, 256, Paint.shade(color, 0.93f), gold, mask, 0.62f, 37);
        if (!mask) {
            int bone = Paint.luma(color) > 0.5f ? Paint.shade(color, 0.86f) : Paint.shade(color, 1.3f);
            g.setPaint(new GradientPaint(0, 0, Paint.c(Paint.shade(bone, 1.08f)), 0, 80, Paint.c(Paint.shade(bone, 0.8f))));
            g.fillRect(192, 0, 64, 80);
        }
        g.dispose();
        return img;
    }

    /**
     * One feather in a column x0..x0+w, root at the top: a tapered vane (widest at "belly") around a
     * shaft, soft barbs, a darker base and a lighter (or golden) tip.
     */
    private static void featherSprite(Graphics2D g, int x0, int w, int h, int color, boolean gold, boolean mask, float belly, long seed) {
        float cx = x0 + w / 2f;
        Path2D vane = new Path2D.Float();
        float top = 6, bot = h - 4, half = w / 2f - 3;
        vane.moveTo(cx, top);
        vane.curveTo(cx + half * 0.55f, top + 8, cx + half, top + (bot - top) * belly, cx + half * 0.72f, bot - (bot - top) * 0.18f);
        vane.quadTo(cx + half * 0.3f, bot - 2, cx, bot);
        vane.quadTo(cx - half * 0.36f, bot - 3, cx - half * 0.78f, bot - (bot - top) * 0.2f);
        vane.curveTo(cx - half, top + (bot - top) * belly, cx - half * 0.55f, top + 8, cx, top);
        vane.closePath();
        int tip = gold ? 0xF2C46A : Paint.shade(color, 1.18f);
        if (mask) {
            g.setClip(vane);
            g.setColor(Paint.c(Paint.mix(color, 0xFFF4D0, 0.6f), 40));
            g.fill(vane);
            g.setStroke(new BasicStroke(5f));
            g.setColor(Paint.c(gold ? 0xFFD27A : 0xFFFBEA, 150));
            g.draw(vane);
            g.setClip(null);
            return;
        }
        g.setClip(vane);
        g.setPaint(new GradientPaint(0, top, Paint.c(Paint.shade(color, 0.78f)), 0, bot, Paint.c(tip)));
        g.fillRect(x0, 0, w, h);
        // barbs: fine diagonal strokes from the shaft outwards, slightly curved
        Random r = new Random(seed);
        g.setStroke(new BasicStroke(1f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        for (float y = top + 4; y < bot; y += 2.2f) {
            for (int sgn = -1; sgn <= 1; sgn += 2) {
                boolean light = r.nextFloat() < 0.5f;
                g.setColor(light ? Paint.c(Paint.shade(color, 1.3f), 70) : new Color(0, 0, 0, 34));
                g.draw(new Line2D.Float(cx, y, cx + sgn * half * 1.1f, y + 10 + r.nextFloat() * 4));
            }
        }
        // a few split gaps in the vane
        for (int i = 0; i < 3; i++) {
            float y = top + 40 + r.nextFloat() * (bot - top - 70);
            int sgn = r.nextBoolean() ? 1 : -1;
            g.setColor(new Color(0, 0, 0, 60));
            g.setStroke(new BasicStroke(1.4f));
            g.draw(new Line2D.Float(cx + sgn * 2, y, cx + sgn * half, y + 14));
        }
        // shading towards the edges for some roundness
        g.setPaint(new GradientPaint(cx - half, 0, new Color(0, 0, 0, 50), cx, 0, new Color(0, 0, 0, 0), true));
        g.fillRect(x0, 0, w, h);
        g.setClip(null);
        g.setColor(new Color(0, 0, 0, 70));
        g.setStroke(new BasicStroke(1.2f));
        g.draw(vane);
        // shaft
        g.setStroke(new BasicStroke(2.2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(Paint.c(Paint.shade(color, Paint.luma(color) > 0.5f ? 0.82f : 1.5f)));
        g.draw(new Line2D.Float(cx, top, cx, bot - 6));
    }
}
