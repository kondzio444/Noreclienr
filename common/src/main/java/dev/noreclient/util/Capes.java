package dev.noreclient.util;

import dev.noreclient.api.Platform;
import dev.noreclient.api.TextureRef;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.LinearGradientPaint;
import java.awt.RadialGradientPaint;
import java.awt.RenderingHints;
import java.awt.Shape;
import java.awt.geom.AffineTransform;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Line2D;
import java.awt.geom.Path2D;
import java.awt.geom.Rectangle2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;

/**
 * Nore capes drawn in code (64x32 cape layout at 4x resolution) – no image files needed.
 * The first three are the "Historia Nore" collection, one for each update that shaped the project,
 * the next three the animated "Halloween" set.
 */
public final class Capes {
    public static final String[] NAMES = {"Brak", "Genesis", "Kuźnia 2.1", "Nova 1.4",
            "Dynia", "Nietoperz", "Pajęczyna", "Nore Orange", "Ember", "Violet", "Ocean", "Emerald", "Sakura", "Gold", "Ice", "Galaxy"};
    /** Capes of the "Historia Nore" collection (indexes into NAMES). */
    private static final int HISTORY_END = 4;
    /** Capes of the "Halloween" set (indexes HISTORY_END..HALLOWEEN_END-1). */
    private static final int HALLOWEEN_END = 7;
    private static final String[] TAGLINES = {"", "Początek • 1.0", "Launcher • 2.1", "Nowa era • 1.4",
            "Halloween 2026", "Halloween 2026", "Halloween 2026"};
    private static final int[][] COLORS = {
            {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0}, {0, 0},
            {0xFFB547, 0xFF5A1A}, {0xFF6B2C, 0x5A0E00}, {0xC9A4FF, 0x5B2BD6}, {0x7FD0FF, 0x1A4DFF}, {0x8AF0C0, 0x0E7A52},
            {0xFFADD9, 0xC12E86}, {0xFFE08A, 0xD68A00}, {0xE6FAFF, 0x3CB8E0}, {0x8A5CFF, 0x0A0820}};
    /** Edge colour (sides, top and bottom of the cape) of the collection capes. */
    private static final int[] EDGES = {0, 0x1A1410, 0x3A0C04, 0x140A34, 0x4A1A04, 0x0E0620, 0x0C0B12};
    private static final Map<String, TextureRef> CACHE = new HashMap<String, TextureRef>();
    private static final int S = 4, W = 10 * S, H = 16 * S;
    /** Animation frames of the collection capes (one loop). */
    public static final int FRAMES = 16;

    private Capes() {}

    /** True for the "Historia Nore" collection capes. */
    public static boolean isHistory(String name) {
        int i = index(name);
        return i > 0 && i < HISTORY_END;
    }

    /** True for the "Halloween" set. */
    public static boolean isHalloween(String name) {
        int i = index(name);
        return i >= HISTORY_END && i < HALLOWEEN_END;
    }

    /** Badge of the collection the cape belongs to ("HISTORIA", "HALLOWEEN"), null for the plain capes. */
    public static String collection(String name) {
        return isHistory(name) ? "HISTORIA" : isHalloween(name) ? "HALLOWEEN" : null;
    }

    /** Short description shown under collection capes, "" for the others. */
    public static String tagline(String name) {
        int i = index(name);
        return i > 0 && i < HALLOWEEN_END ? TAGLINES[i] : "";
    }

    /** True when the cape has animation frames (both collections). */
    public static boolean isAnimated(String name) {
        int i = index(name);
        return i > 0 && i < HALLOWEEN_END;
    }

    private static int index(String name) {
        for (int i = 0; i < NAMES.length; i++) if (NAMES[i].equals(name)) return i;
        return 0;
    }

    private static String id(String name) {
        return name.toLowerCase().replace('ź', 'z').replace('ę', 'e').replaceAll("[^a-z0-9]", "_");
    }

    /** Wardrobe / Nore Hub id of a cape name ("Kuźnia 2.1" → "kuznia_2_1"). */
    public static String capeId(String name) { return id(name); }

    /** Cape name for a wardrobe id, or null when unknown. */
    public static String byId(String capeId) {
        for (int i = 1; i < NAMES.length; i++) if (id(NAMES[i]).equals(capeId)) return NAMES[i];
        return null;
    }

    /** Texture of the named cape (render thread); null for "Brak". */
    public static TextureRef texture(String name) { return texture(name, 0); }

    /** One animation frame of the cape (frame is ignored for still capes). */
    public static TextureRef texture(String name, int frame) {
        if (name == null || name.equals(NAMES[0])) return null;
        frame = isAnimated(name) ? Math.floorMod(frame, FRAMES) : 0;
        return load(CACHE, "cape/", name, frame, false);
    }

    /** Encoded frames waiting to be uploaded (key "prefix name#frame"). */
    private static final Map<String, byte[]> READY = new java.util.concurrent.ConcurrentHashMap<String, byte[]>();
    private static final java.util.Set<String> PENDING = java.util.Collections.newSetFromMap(new java.util.concurrent.ConcurrentHashMap<String, Boolean>());
    private static final java.util.concurrent.ExecutorService WORKER = java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
        Thread th = new Thread(r, "Nore cape renderer");
        th.setDaemon(true);
        th.setPriority(Thread.MIN_PRIORITY);
        return th;
    });

    /**
     * Frame 0 is drawn right away; the other frames are drawn on a background thread and only uploaded here,
     * so the animation never stalls the render thread. Until a frame is ready the nearest earlier one is shown.
     */
    private static TextureRef load(Map<String, TextureRef> cache, String prefix, String name, int frame, boolean front) {
        String key = name + "#" + frame;
        TextureRef t = cache.get(key);
        if (t != null) return t;
        byte[] png = READY.remove(prefix + key);
        if (png == null && frame == 0) png = draw(name, 0, front);
        if (png == null) {
            if (PENDING.add(prefix + name)) {
                WORKER.execute(() -> {
                    for (int f = 1; f < FRAMES; f++) {
                        byte[] b = draw(name, f, front);
                        if (b != null) READY.put(prefix + name + "#" + f, b);
                    }
                });
            }
            for (int f = frame - 1; f >= 0; f--) {
                TextureRef prev = cache.get(name + "#" + f);
                if (prev != null) return prev;
            }
            return frame > 0 ? load(cache, prefix, name, 0, front) : null;
        }
        t = Platform.game().loadTexture(prefix + id(name) + "_f" + frame, png);
        if (t != null) cache.put(key, t);
        return t;
    }

    private static byte[] draw(String name, int frame, boolean front) {
        float time = frame / (float) FRAMES;
        return front ? encode(front(name, time)) : png(name, time);
    }

    private static final Map<String, TextureRef> PREVIEWS = new HashMap<String, TextureRef>();

    /** Only the front of the cape (for the cosmetics menu). */
    public static TextureRef preview(String name) { return preview(name, 0); }

    public static TextureRef preview(String name, int frame) {
        if (name == null || name.equals(NAMES[0])) return null;
        frame = isAnimated(name) ? Math.floorMod(frame, FRAMES) : 0;
        return load(PREVIEWS, "capeprev/", name, frame, true);
    }

    /** Just the outer face, 40x64, at animation time t (0..1). */
    static BufferedImage front(String name, float t) {
        int idx = index(name);
        if (idx == 0) return null;
        BufferedImage img = new BufferedImage(W, H, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = graphics(img);
        design(g, idx, t);
        g.dispose();
        return img;
    }

    static BufferedImage front(String name) { return front(name, 0); }

    static byte[] png(String name) { return png(name, 0); }

    static byte[] png(String name, float t) {
        return encode(image(name, t));
    }

    /** Full 64x32 cape texture (4x resolution) of one animation frame, for the wardrobe preview. */
    public static BufferedImage image(String name, int frame) {
        frame = isAnimated(name) ? Math.floorMod(frame, FRAMES) : 0;
        return image(name, frame / (float) FRAMES);
    }

    static BufferedImage image(String name, float t) {
        int idx = index(name);
        if (idx == 0) return null;
        BufferedImage img = new BufferedImage(64 * S, 32 * S, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = graphics(img);
        Color edge = idx < HALLOWEEN_END ? new Color(EDGES[idx]) : new Color(COLORS[idx][1]).darker();
        // cape box: top/bottom (1..21, 0), sides, front (1,1 10x16), back (12,1 10x16)
        g.setColor(edge);
        g.fillRect(0, 0, 22 * S, 17 * S);
        // elytra box: front (24,2 10x20), back (36,2 10x20) and its edges
        g.fillRect(22 * S, 0, 24 * S, 22 * S);
        paint(g, idx, t, S, S, 1f, false);
        paint(g, idx, t, 12 * S, S, 1f, true);
        paint(g, idx, t, 24 * S, 2 * S, 1.25f, false);
        paint(g, idx, t, 36 * S, 2 * S, 1.25f, false);
        g.dispose();
        return img;
    }

    private static Graphics2D graphics(BufferedImage img) {
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        return g;
    }

    private static byte[] encode(BufferedImage img) {
        if (img == null) return null;
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            System.setProperty("java.awt.headless", "true");
            javax.imageio.ImageIO.write(img, "png", out);
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    /** Draws the 40x64 design at (x, y), stretched vertically by sy; the inner side is darkened. */
    private static void paint(Graphics2D g, int idx, float t, int x, int y, float sy, boolean inner) {
        AffineTransform old = g.getTransform();
        Shape clip = g.getClip();
        g.translate(x, y);
        g.scale(1, sy);
        g.clipRect(0, 0, W, H);
        design(g, idx, t);
        if (inner) {
            g.setColor(new Color(0, 0, 0, 120));
            g.fillRect(0, 0, W, H);
        }
        g.setTransform(old);
        g.setClip(clip);
    }

    private static void design(Graphics2D g, int idx, float t) {
        switch (idx) {
            case 1: genesis(g, t); break;
            case 2: forge(g, t); break;
            case 3: nova(g, t); break;
            case 4: pumpkin(g, t); break;
            case 5: bats(g, t); break;
            case 6: web(g, t); break;
            default: classic(g, idx);
        }
    }

    // ---------------------------------------------------------------- Genesis (1.0)

    private static final int[][] GENESIS_N = {
            {0, 0}, {0, 1}, {0, 4},
            {1, 0}, {1, 1}, {1, 2}, {1, 4},
            {2, 0}, {2, 2}, {2, 3}, {2, 4},
            {3, 0}, {3, 3}, {3, 4},
            {4, 0}, {4, 4}};

    /** Where it all began: the Nore "N" built from blocks, HUD editor brackets and ClickGUI module tiles. */
    private static void genesis(Graphics2D g, float t) {
        double ph = t * Math.PI * 2;
        g.setPaint(new GradientPaint(0, 0, new Color(0x2E241D), 0, H, new Color(0x0D0A08)));
        g.fillRect(0, 0, W, H);
        // faint block grid
        g.setColor(new Color(255, 255, 255, 9));
        for (int i = 4; i < W; i += 4) g.fill(new Rectangle2D.Float(i, 0, 0.5f, H));
        for (int i = 4; i < H; i += 4) g.fill(new Rectangle2D.Float(0, i, W, 0.5f));
        // ClickGUI title bar with blinking window dots
        g.setPaint(new GradientPaint(0, 0, new Color(0xFFB547), W, 0, new Color(0xFF5A1A)));
        g.fillRect(0, 0, W, 4);
        for (int i = 0; i < 3; i++) {
            boolean lit = (int) (t * 6) % 3 == i;
            g.setColor(lit ? new Color(0xFFF3D6) : new Color(0x2A1A10));
            g.fill(new Ellipse2D.Float(W - 5 - i * 3.5f, 1.25f, 1.5f, 1.5f));
        }
        g.setColor(new Color(0x2A1A10));
        g.fill(new Rectangle2D.Float(3, 1.5f, 8, 1));
        // breathing glow behind the logo
        glow(g, 20, 24, 19 + (float) Math.sin(ph) * 2, new Color(255, 138, 31, (int) (130 + 50 * Math.sin(ph))));
        // HUD editor: brackets and a selection scan line
        g.setColor(new Color(255, 255, 255, 200));
        brackets(g, 6, 10, 28, 29, 5, 1);
        g.setColor(new Color(255, 181, 71, 90));
        dashed(g, 8, 12, 24, 25);
        float sy = 12 + t * 23;
        g.setPaint(new GradientPaint(0, sy - 3, new Color(255, 210, 120, 0), 0, sy, new Color(255, 210, 120, 70)));
        g.fill(new Rectangle2D.Float(8.5f, sy - 3, 23, 3));
        g.setColor(new Color(255, 236, 190, 150));
        g.fill(new Rectangle2D.Float(8.5f, sy, 23, 0.5f));
        // the bold block "N"; a light sweep runs over it
        for (int[] c : GENESIS_N) {
            float bx = 10 + c[1] * 4, by = 14 + c[0] * 4;
            block(g, bx, by, 4, new Color(0xFFD27A), new Color(0xFF6A1A));
            float d = Math.abs(((c[0] + c[1]) / 8f) - t * 1.6f + 0.3f);
            if (d < 0.18f) {
                g.setColor(new Color(255, 255, 255, (int) (150 * (1 - d / 0.18f))));
                g.fill(new Rectangle2D.Float(bx, by, 4, 4));
            }
        }
        pixelText(g, "1.0", 20, 42, 1.5f, new Color(0xFFE7C2), true);
        // 2x2 module tiles: two on, one off and one that keeps toggling
        float k = (float) Math.max(0, Math.min(1, 0.5 + Math.sin(ph) * 1.5));
        for (int i = 0; i < 4; i++) {
            float tx = 4 + (i % 2) * 17, ty = 51 + (i / 2) * 6.5f;
            float on = i == 0 || i == 3 ? 1 : i == 1 ? k : 0;
            g.setColor(new Color(0x221A15));
            g.fill(new RoundRectangle2D.Float(tx, ty, 15, 5, 2, 2));
            g.setColor(mix(new Color(255, 255, 255, 30), new Color(255, 138, 31, 150), on));
            g.draw(new RoundRectangle2D.Float(tx + 0.25f, ty + 0.25f, 14.5f, 4.5f, 2, 2));
            g.setColor(new Color(255, 255, 255, (int) (70 + 80 * on)));
            g.fill(new Rectangle2D.Float(tx + 1.5f, ty + 2, 6, 1));
            g.setColor(mix(new Color(0x4A403A), new Color(0xFF8A1F), on));
            g.fill(new RoundRectangle2D.Float(tx + 9.5f, ty + 1.25f, 4.5f, 2.5f, 2.5f, 2.5f));
            g.setColor(Color.WHITE);
            g.fill(new Ellipse2D.Float(tx + 9.75f + 2 * on, ty + 1.5f, 2, 2));
        }
        frame(g, new Color(255, 138, 31, 150), new Color(255, 181, 71, 40));
        spark(g, t, new Color(255, 230, 170));
    }

    // ---------------------------------------------------------------- Kuźnia 2.1

    /** The 2.1 update: launcher and Auto Craft – a crafting grid forging a red-hot pickaxe over the flames. */
    private static void forge(Graphics2D g, float t) {
        double ph = t * Math.PI * 2;
        g.setPaint(new LinearGradientPaint(0, 0, 0, H, new float[]{0f, 0.55f, 1f},
                new Color[]{new Color(0x1C0603), new Color(0x4A1406), new Color(0xA8340A)}));
        g.fillRect(0, 0, W, H);
        glow(g, 20, 70, 40 + (float) Math.sin(ph * 2) * 3, new Color(255, 122, 0, 210));
        // flickering flames
        Random r = new Random(5);
        for (int i = 0; i < 9; i++) {
            float fx = -2 + i * 5.5f + r.nextFloat() * 2, fh = 9 + r.nextFloat() * 11, fw = 6 + r.nextFloat() * 3;
            fh *= 1 + 0.18f * (float) Math.sin(ph * (2 + i % 2) + i * 1.7);
            flame(g, fx, H + 1, fw, fh, i % 2 == 0 ? new Color(255, 196, 64) : new Color(255, 120, 30));
        }
        // embers rising and looping
        r = new Random(21);
        for (int i = 0; i < 46; i++) {
            float y0 = r.nextFloat() * H, ex = r.nextFloat() * W, d = 0.5f + r.nextFloat() * 1.1f;
            int speed = 1 + r.nextInt(2);
            boolean yellow = r.nextBoolean();
            float ey = ((y0 - t * H * speed) % H + H) % H;
            float drift = (float) Math.sin(ph * speed + i) * 1.2f;
            int a = (int) (40 + 210 * (ey / H));
            g.setColor(yellow ? new Color(255, 214, 120, a) : new Color(255, 120, 40, a));
            g.fill(new Rectangle2D.Float(ex + drift, ey, d, d));
        }
        // crafting table plate
        g.setColor(new Color(24, 10, 6, 225));
        g.fill(new RoundRectangle2D.Float(4.5f, 2.5f, 31, 31, 3, 3));
        g.setColor(new Color(255, 138, 31, 120));
        g.draw(new RoundRectangle2D.Float(5, 3, 30, 30, 3, 3));
        // 3x3 grid with the pickaxe recipe (3 ingots + 2 sticks); Auto Craft fills it slot by slot
        int filled = (int) (t * 10);
        int n = 0;
        for (int row = 0; row < 3; row++) {
            for (int col = 0; col < 3; col++) {
                float cx = 7 + col * 9, cy = 5 + row * 9;
                slot(g, cx, cy, 8);
                boolean item = row == 0 || col == 1;
                if (!item) continue;
                boolean shown = n++ < filled || filled >= 8;
                if (!shown) continue;
                if (row == 0) ingot(g, cx + 1, cy + 2);
                else stick(g, cx + 1, cy + 1);
            }
        }
        // arrow down to the result
        float bob = (float) Math.sin(ph * 2) * 0.8f;
        g.setColor(new Color(0xFFD27A));
        g.fill(new Rectangle2D.Float(19.25f, 34.5f + bob, 1.5f, 2.5f));
        Path2D head = new Path2D.Float();
        head.moveTo(17, 37 + bob);
        head.lineTo(23, 37 + bob);
        head.lineTo(20, 40 + bob);
        head.closePath();
        g.fill(head);
        // result slot with the glowing pickaxe
        glow(g, 20, 47, 12 + (float) Math.sin(ph) * 2, new Color(255, 214, 90, (int) (160 + 60 * Math.sin(ph))));
        slot(g, 14, 41, 12);
        g.setColor(new Color(255, 200, 80, 170));
        g.draw(new Rectangle2D.Float(13.75f, 40.75f, 12.5f, 12.5f));
        pickaxe(g, 16, 43, 1f);
        float shine = (t * 1.5f) % 1.5f;
        if (shine < 1) {
            Shape clip = g.getClip();
            g.clip(new Rectangle2D.Float(15, 42, 10, 10));
            g.setColor(new Color(255, 255, 255, 120));
            g.rotate(0.6, 20, 47);
            g.fill(new Rectangle2D.Float(12 + shine * 16, 38, 1.5f, 18));
            g.rotate(-0.6, 20, 47);
            g.setClip(clip);
        }
        g.setColor(new Color(28, 8, 2, 200));
        g.fill(new RoundRectangle2D.Float(11, 54.5f, 18, 10, 3, 3));
        pixelText(g, "2.1", 20, 56, 1.4f, new Color(0xFFE08A), true);
        frame(g, new Color(255, 160, 60, 160), new Color(255, 80, 20, 50));
        spark(g, t, new Color(255, 236, 160));
    }

    // ---------------------------------------------------------------- Nova 1.4

    /** 1.4 Beta: the night sky over the panorama, the multiplayer globe with a server flag and friends as a constellation. */
    private static void nova(Graphics2D g, float t) {
        double ph = t * Math.PI * 2;
        g.setPaint(new LinearGradientPaint(0, 0, 0, H, new float[]{0f, 0.5f, 1f},
                new Color[]{new Color(0x0B0620), new Color(0x2A1260), new Color(0x0A2350)}));
        g.fillRect(0, 0, W, H);
        // drifting aurora bands
        aurora(g, 9, 3.5f, 0.32f, (float) ph, new Color(80, 255, 210), 110);
        aurora(g, 15, 2.5f, 0.45f, (float) -ph, new Color(190, 120, 255), 90);
        // twinkling stars
        Random r = new Random(14);
        for (int i = 0; i < 60; i++) {
            float sx = r.nextFloat() * W, sy = r.nextFloat() * H, d = 0.4f + r.nextFloat() * 0.8f;
            int base = 70 + r.nextInt(170);
            double tw = 0.55 + 0.45 * Math.sin(ph * (1 + i % 2) + i * 2.3);
            g.setColor(new Color(255, 255, 255, (int) (base * tw)));
            g.fill(new Ellipse2D.Float(sx, sy, d, d));
        }
        sparkle(g, 6, 6, 2f + 0.8f * (float) Math.sin(ph), new Color(255, 255, 255, 230));
        sparkle(g, 34, 20, 1.6f + 0.6f * (float) Math.sin(ph + 2), new Color(200, 230, 255, 210));
        sparkle(g, 33, 60, 1.3f + 0.5f * (float) Math.sin(ph + 4), new Color(255, 214, 160, 200));
        // shooting star
        if (t > 0.55f && t < 0.8f) {
            float k = (t - 0.55f) / 0.25f, x = 4 + k * 30, y = 3 + k * 9;
            g.setPaint(new GradientPaint(x - 7, y - 2, new Color(255, 255, 255, 0), x, y, new Color(255, 255, 255, (int) (230 * (1 - k)))));
            g.setStroke(new BasicStroke(0.75f));
            g.draw(new Line2D.Float(x - 7, y - 2.1f, x, y));
        }
        float gx = 20, gy = 28, gr = 10;
        glow(g, gx, gy, 18, new Color(110, 140, 255, 120));
        // satellite on the orbit: drawn behind the globe on the far half
        double a = ph;
        boolean behind = Math.sin(a) < 0;
        AffineTransform at = g.getTransform();
        g.rotate(-0.35, gx, gy);
        g.setStroke(new BasicStroke(0.75f));
        g.setColor(new Color(255, 138, 31, 200));
        g.draw(new java.awt.geom.Arc2D.Float(gx - 15, gy - 4, 30, 8, 0, 180, java.awt.geom.Arc2D.OPEN));
        if (behind) satellite(g, gx, gy, a);
        g.setTransform(at);
        // the globe with slowly turning meridians
        g.setPaint(new RadialGradientPaint(gx - 3, gy - 4, gr * 1.6f, new float[]{0f, 1f},
                new Color[]{new Color(0x3F7BFF), new Color(0x10184A)}));
        Ellipse2D globe = new Ellipse2D.Float(gx - gr, gy - gr, gr * 2, gr * 2);
        g.fill(globe);
        Shape clip = g.getClip();
        g.clip(globe);
        g.setStroke(new BasicStroke(0.5f));
        g.setColor(new Color(127, 227, 255, 110));
        for (int m = 0; m < 4; m++) {
            double lon = ph / 4 + m * Math.PI / 4;
            float w = (float) Math.abs(Math.cos(lon)) * gr;
            g.draw(new Ellipse2D.Float(gx - w, gy - gr, w * 2, gr * 2));
        }
        for (float k : new float[]{-0.55f, 0f, 0.55f}) g.draw(new Line2D.Float(gx - gr, gy + gr * k, gx + gr, gy + gr * k));
        g.setClip(clip);
        g.setStroke(new BasicStroke(0.75f));
        g.setColor(new Color(127, 227, 255, 220));
        g.draw(globe);
        g.rotate(-0.35, gx, gy);
        g.setColor(new Color(255, 138, 31, 200));
        g.draw(new java.awt.geom.Arc2D.Float(gx - 15, gy - 4, 30, 8, 180, 180, java.awt.geom.Arc2D.OPEN));
        if (!behind) satellite(g, gx, gy, a);
        g.setTransform(at);
        // flag pinned on the globe (server location), waving
        g.setColor(new Color(0xE8E8F0));
        g.fill(new Rectangle2D.Float(23, 17, 0.75f, 9));
        for (int c = 0; c < 6; c++) {
            float wy = (float) Math.sin(ph * 2 - c * 0.9) * 0.45f * (c / 5f);
            g.setColor(Color.WHITE);
            g.fill(new Rectangle2D.Float(23.75f + c, 17 + wy, 1.05f, 2));
            g.setColor(new Color(0xDC143C));
            g.fill(new Rectangle2D.Float(23.75f + c, 19 + wy, 1.05f, 2));
        }
        g.setColor(new Color(0xFF8A1F));
        g.fill(new Ellipse2D.Float(22.4f, 25.4f, 2, 2));
        // friends constellation; "you" sends out a pulse
        float[][] nodes = {{5, 46}, {12, 50}, {20, 45}, {28, 50}, {35, 43}, {20, 40}};
        int[][] links = {{0, 1}, {1, 2}, {2, 3}, {3, 4}, {2, 5}, {0, 2}};
        g.setStroke(new BasicStroke(0.5f));
        g.setColor(new Color(200, 180, 255, 150));
        for (int[] l : links) g.draw(new Line2D.Float(nodes[l[0]][0], nodes[l[0]][1], nodes[l[1]][0], nodes[l[1]][1]));
        float pr = 1.5f + t * 7;
        g.setColor(new Color(255, 138, 31, (int) (200 * (1 - t))));
        g.draw(new Ellipse2D.Float(nodes[2][0] - pr, nodes[2][1] - pr, pr * 2, pr * 2));
        for (int i = 0; i < nodes.length - 1; i++) {
            boolean you = i == 2;
            Color c = you ? new Color(0xFF8A1F) : new Color(0xD9C8FF);
            float lit = you ? 1 : (float) (0.6 + 0.4 * Math.sin(ph + i * 1.3));
            glow(g, nodes[i][0], nodes[i][1], you ? 4 : 2.5f, new Color(c.getRed(), c.getGreen(), c.getBlue(), (int) (160 * lit)));
            g.setColor(c);
            float d = you ? 2.2f : 1.5f;
            g.fill(new Ellipse2D.Float(nodes[i][0] - d / 2, nodes[i][1] - d / 2, d, d));
        }
        g.setStroke(new BasicStroke(1f));
        pixelText(g, "1.4β", 20, 54.5f, 1.4f, new Color(0xF2E9FF), true);
        frame(g, new Color(169, 107, 255, 170), new Color(127, 227, 255, 50));
        spark(g, t, new Color(200, 240, 255));
    }

    private static void satellite(Graphics2D g, float gx, float gy, double a) {
        float sx = gx + 15 * (float) Math.cos(a), sy = gy + 4 * (float) Math.sin(a);
        glow(g, sx, sy, 3, new Color(255, 210, 122, 180));
        g.setColor(new Color(0xFFD27A));
        g.fill(new Ellipse2D.Float(sx - 1.25f, sy - 1.25f, 2.5f, 2.5f));
    }

    // ---------------------------------------------------------------- Halloween: Dynia

    private static final int[] PUMPKIN = {0x2E0D02, 0x541A04, 0x7E2A06, 0xA83C08, 0xD0540C, 0xEC6E14, 0xFF8C28, 0xFFB050};
    private static final int[] BAYER = {0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5};

    /** Ordered-dithered pick from a colour ramp: gives the soft gradients a crisp pixel-art look. */
    private static int ramp(int[] pal, float v, int x, int y) {
        float f = Math.max(0, Math.min(0.999f, v)) * (pal.length - 1);
        int i = (int) f;
        float d = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5f) / 16f;
        return pal[Math.min(pal.length - 1, f - i > d ? i + 1 : i)] | 0xFF000000;
    }

    /** Candle flicker in 0.55..1 that loops with the animation. */
    private static float flicker(double ph) {
        return (float) (0.8 + 0.11 * Math.sin(ph * 3 + 0.4) + 0.07 * Math.sin(ph * 5 + 2) + 0.04 * Math.sin(ph * 11 + 1));
    }

    private static Path2D poly(float... p) {
        Path2D path = new Path2D.Float();
        path.moveTo(p[0], p[1]);
        for (int i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]);
        path.closePath();
        return path;
    }

    /** A carved jack-o'-lantern: ribbed pumpkin skin, stem with a vine and a leaf, candle light flickering inside. */
    private static void pumpkin(Graphics2D g, float t) {
        double ph = t * Math.PI * 2;
        float fl = flicker(ph);
        // ribbed skin, lit from the upper left
        BufferedImage skin = new BufferedImage(W, H, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < H; y++) {
            for (int x = 0; x < W; x++) {
                float px = x + 0.5f, py = y + 0.5f;
                float bow = 1 + 0.18f * (float) Math.sin(Math.PI * py / H);
                float u = (px - 20) / bow;
                float fr = (u + 20) / 8f;
                fr -= (float) Math.floor(fr);
                float rib = (float) Math.sin(Math.PI * fr);
                float v = 0.22f + 0.5f * (float) Math.pow(rib, 0.55);
                v += 0.16f * (1 - Math.abs(u + 4) / 22f);
                v -= 0.30f * Math.max(0, (py - 36) / 28f);
                v -= 0.22f * Math.max(0, (9 - py) / 9f);
                // glossy highlight on the upper-left of each rib crown
                if (fr > 0.22f && fr < 0.42f && py > 8 && py < 30) v += 0.12f * (float) Math.sin(Math.PI * (py - 8) / 22);
                skin.setRGB(x, y, ramp(PUMPKIN, v, x, y));
            }
        }
        g.drawImage(skin, 0, 0, null);
        // candle light spilling on the skin around the face
        glow(g, 20, 37, 22 + fl * 6, new Color(255, 120, 20, (int) (25 + 45 * fl)));
        Path2D eyeL = poly(5, 28, 17, 29, 13.5f, 16.5f);
        Path2D eyeR = poly(35, 28, 23, 29, 26.5f, 16.5f);
        Path2D nose = poly(17.2f, 35.5f, 22.8f, 35.5f, 20, 30.5f);
        Path2D mouth = poly(3.5f, 37, 8, 40.5f, 12.5f, 41.8f, 12.5f, 45.5f, 16.5f, 45.5f, 16.5f, 42.2f,
                23.5f, 42.2f, 23.5f, 45.5f, 27.5f, 45.5f, 27.5f, 41.8f, 32, 40.5f, 36.5f, 37,
                34.5f, 44, 29, 48.5f, 23, 50.8f, 23, 47.2f, 17, 47.2f, 17, 50.8f, 11, 48.5f, 5.5f, 44);
        Path2D face = new Path2D.Float();
        for (Path2D p : new Path2D[]{eyeL, eyeR, nose, mouth}) face.append(p, false);
        // dark cut edge, pale flesh wall on the upper-left, then the glowing hollow seen through it
        g.setStroke(new BasicStroke(1.6f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(new Color(36, 8, 0, 230));
        g.draw(face);
        g.setColor(new Color(0xFFE4A0));
        g.fill(face);
        Shape clip = g.getClip();
        g.clip(face);
        AffineTransform at = g.getTransform();
        g.translate(0.8, 1.2);
        g.clip(face);
        g.setTransform(at);
        float cx = 20 + (float) Math.sin(ph * 2) * 1.5f, cy = 37 - fl;
        g.setPaint(new RadialGradientPaint(cx, cy, 20 + fl * 12, new float[]{0f, 0.3f, 0.66f, 1f},
                new Color[]{new Color(255, 255, 232), new Color(255, 236, 120), new Color(255, 178, 36), new Color(220, 90, 8)}));
        g.fill(new Rectangle2D.Float(0, 0, W, H));
        // the back wall darkens towards the top of each hole
        g.setPaint(new GradientPaint(0, 16, new Color(150, 40, 0, 110), 0, 24, new Color(150, 40, 0, 0)));
        g.fill(new Rectangle2D.Float(0, 16, W, 8));
        g.setClip(clip);
        // hot rim light on the upper eye edges
        g.setStroke(new BasicStroke(0.6f));
        g.setColor(new Color(255, 230, 150, (int) (120 * fl)));
        g.draw(new Line2D.Float(6.5f, 27.6f, 12.9f, 18.6f));
        g.draw(new Line2D.Float(33.5f, 27.6f, 27.1f, 18.6f));
        // stem, vine and leaf
        g.setPaint(new GradientPaint(17, 0, new Color(0x6E8A2A), 23, 0, new Color(0x2E3E10)));
        g.fill(poly(17, 0, 23.5f, 0, 22.5f, 6.5f, 21.5f, 8, 18.5f, 8, 17.5f, 6.5f));
        g.setColor(new Color(0x9CBF4A));
        g.fill(new Rectangle2D.Float(18.3f, 0, 0.9f, 7));
        g.setColor(new Color(0x24300C));
        g.fill(new Rectangle2D.Float(21.6f, 0, 0.8f, 7.5f));
        g.setColor(new Color(60, 20, 0, 140));
        g.fill(new Ellipse2D.Float(16, 7, 8, 2.4f));
        // curly tendril to the right, gently swaying
        float sw = (float) Math.sin(ph) * 0.6f;
        Path2D vine = new Path2D.Float();
        vine.moveTo(23, 3);
        vine.curveTo(27, 1, 30, 5 + sw, 32.5f, 3.5f + sw);
        vine.curveTo(35.5f, 1.5f + sw, 34.5f, -1 + sw, 32.5f, 0.5f + sw);
        vine.curveTo(31, 1.6f + sw, 32, 3 + sw, 33.2f, 2.4f + sw);
        g.setStroke(new BasicStroke(1.1f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(new Color(0x2E4A10));
        g.draw(vine);
        g.setStroke(new BasicStroke(0.6f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(new Color(0x8CC43C));
        g.draw(vine);
        // leaf to the left, with a vein
        AffineTransform la = g.getTransform();
        g.rotate(-0.25 + Math.sin(ph) * 0.05, 17.5f, 3.5f);
        Path2D leaf = new Path2D.Float();
        leaf.moveTo(17.5f, 3.5f);
        leaf.curveTo(14, -0.5f, 8, 0, 5, 3.5f);
        leaf.lineTo(7, 4);
        leaf.lineTo(6, 6);
        leaf.curveTo(9, 8.5f, 14.5f, 7.5f, 17.5f, 3.5f);
        leaf.closePath();
        g.setPaint(new GradientPaint(5, 1, new Color(0x8CC43C), 15, 8, new Color(0x3C6A14)));
        g.fill(leaf);
        g.setColor(new Color(0x234408));
        g.setStroke(new BasicStroke(0.5f));
        g.draw(leaf);
        g.setColor(new Color(0xC6E87A));
        g.draw(new Line2D.Float(16.5f, 3.6f, 7.5f, 3.9f));
        g.draw(new Line2D.Float(13, 3.7f, 11, 1.8f));
        g.draw(new Line2D.Float(11, 3.8f, 9.5f, 6));
        g.setTransform(la);
        frame(g, new Color(70, 18, 0, 200), new Color(255, 170, 60, (int) (30 + 30 * fl)));
    }

    // ---------------------------------------------------------------- Halloween: Nietoperz

    private static final int[] NIGHT = {0x07030F, 0x0E0620, 0x170A30, 0x221040, 0x2F1650, 0x3E1C5C, 0x542464, 0x6E2C66};
    /** Bat sprites in three sizes, each with the wings up, level and down; 'e' marks the glinting eyes. */
    private static final String[][][] BAT = {
            {{"X...........X",
              "XX...X.X...XX",
              "XXX..XXX..XXX",
              ".XXXXeXeXXXX.",
              "..XXXXXXXXX..",
              "....XX.XX....",
              "......X......"},
             {".....X.X.....",
              ".....XXX.....",
              "XXX.XeXeX.XXX",
              "XXXXXXXXXXXXX",
              "X.XXXXXXXXX.X",
              "...X.XXX.X...",
              "......X......"},
             {".....X.X.....",
              ".....XXX.....",
              "...XXeXeXX...",
              ".XXXXXXXXXXX.",
              "XXX.XXXXX.XXX",
              "XX...XXX...XX",
              "X.....X.....X"}},
            {{"X.......X",
              "XX.X.X.XX",
              ".XXeXeXX.",
              "..XXXXX..",
              "....X...."},
             {"...X.X...",
              "XX.XXX.XX",
              "XXXeXeXXX",
              "X..XXX..X",
              "....X...."},
             {"...X.X...",
              "..XeXeX..",
              ".XXXXXXX.",
              "XX.XXX.XX",
              "X...X...X"}},
            {{"X...X",
              ".XXX.",
              "..X.."},
             {".X.X.",
              "XXXXX",
              "..X.."},
             {".X.X.",
              ".XXX.",
              "X.X.X"}}};
    private static final int[] FLAP = {0, 1, 2, 1};

    /** Bat of the given size (0 big .. 2 tiny) centred on the pixel grid; eyes glint in the given colour. */
    private static void bat(Graphics2D g, float x, float y, int size, int pose, Color body, Color eyes) {
        String[] rows = BAT[size][FLAP[Math.floorMod(pose, 4)]];
        int ox = Math.round(x) - rows[0].length() / 2, oy = Math.round(y) - rows.length / 2;
        // hard pixels: no anti-aliasing seams when the design is stretched for the elytra
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_OFF);
        for (int r = 0; r < rows.length; r++) {
            for (int c = 0; c < rows[r].length(); c++) {
                char ch = rows[r].charAt(c);
                if (ch == '.') continue;
                g.setColor(ch == 'e' ? eyes : body);
                g.fill(new Rectangle2D.Float(ox + c, oy + r, 1, 1));
            }
        }
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    }

    /** Night-purple sky, a big moon with drifting clouds, bats flapping across and a spooky hill with a lit cottage. */
    private static void bats(Graphics2D g, float t) {
        double ph = t * Math.PI * 2;
        float mx = 25, my = 18, mr = 10.5f;
        BufferedImage sky = new BufferedImage(W, H, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < H; y++) {
            for (int x = 0; x < W; x++) {
                float px = x + 0.5f, py = y + 0.5f;
                float d = (float) Math.hypot(px - mx, py - my);
                float v = 0.08f + 0.78f * (py / H) + 0.30f * Math.max(0, 1 - d / 26f);
                int c = ramp(NIGHT, v, x, y);
                if (d <= mr) {
                    // the moon: crisp pixel disc with a darker limb towards the lower right
                    float shade = ((px - mx) * 0.6f + (py - my) * 0.8f) / mr;
                    c = 0xFF000000 | (d > mr - 0.9f ? 0xFFF8DC : shade > 0.55f ? 0xE8C77A : shade > 0.1f ? 0xF6DD98 : 0xFFF0C0);
                }
                sky.setRGB(x, y, c);
            }
        }
        g.drawImage(sky, 0, 0, null);
        // twinkling stars
        Random r = new Random(31);
        for (int i = 0; i < 34; i++) {
            float sx = r.nextFloat() * W, sy = r.nextFloat() * 46;
            if (Math.hypot(sx - mx, sy - my) < mr + 3) continue;
            double tw = 0.5 + 0.5 * Math.sin(ph * (1 + i % 3) + i * 1.9);
            int base = 90 + r.nextInt(150);
            g.setColor(new Color(255, 240, 255, (int) (base * tw)));
            float d = r.nextInt(4) == 0 ? 1f : 0.6f;
            g.fill(new Rectangle2D.Float(sx, sy, d, d));
        }
        sparkle(g, 6, 9, 1.4f + 0.7f * (float) Math.sin(ph), new Color(255, 240, 255, 220));
        sparkle(g, 9, 33, 1.0f + 0.5f * (float) Math.sin(ph + 2.5), new Color(230, 210, 255, 190));
        // moon halo and craters
        glow(g, mx, my, mr * 2.3f, new Color(255, 230, 170, 60));
        float[][] craters = {{-3.5f, -4, 2.2f}, {3, -1.5f, 1.6f}, {-1, 4, 2.6f}, {5, 5, 1.2f}, {-6, 1.5f, 1.1f}};
        for (float[] c : craters) {
            g.setColor(new Color(214, 176, 100, 150));
            g.fill(new Ellipse2D.Float(mx + c[0] - c[2] / 2, my + c[1] - c[2] / 2, c[2], c[2]));
            g.setColor(new Color(255, 250, 220, 130));
            g.fill(new Ellipse2D.Float(mx + c[0] - c[2] / 2 + 0.4f, my + c[1] - c[2] / 2 + 0.5f, c[2] * 0.75f, c[2] * 0.6f));
        }
        // a thin cloud drifting across the lower half of the moon (loops once per animation)
        float len = 18, cx0 = Math.round(t * (W + len + 8) - len - 4), cyc = 23;
        java.awt.geom.Area cl = new java.awt.geom.Area(new RoundRectangle2D.Float(cx0, cyc, len, 3.4f, 3.4f, 3.4f));
        cl.add(new java.awt.geom.Area(new Ellipse2D.Float(cx0 + 3, cyc - 2.6f, 7, 5.4f)));
        cl.add(new java.awt.geom.Area(new Ellipse2D.Float(cx0 + 8.5f, cyc - 1.6f, 6, 4.4f)));
        g.setColor(new Color(0xA88CD0));
        g.fill(cl);
        Shape clip = g.getClip();
        g.clip(cl);
        g.translate(0, 0.9);
        g.setColor(new Color(0x4C2C70));
        g.fill(cl);
        g.translate(0, 1.6);
        g.setColor(new Color(0x34184E));
        g.fill(cl);
        g.translate(0, -2.5);
        g.setClip(clip);
        // hill with a bare tree, gravestones and a cottage with a warm window
        Color sil = new Color(0x06030B);
        g.setColor(sil);
        Path2D hill = new Path2D.Float();
        hill.moveTo(0, 56);
        hill.curveTo(10, 50.5f, 22, 50, 40, 54.5f);
        hill.lineTo(40, H);
        hill.lineTo(0, H);
        hill.closePath();
        // moonlit rim along the crest
        g.setColor(new Color(0x2C1646));
        g.translate(0, -0.8);
        g.fill(hill);
        g.translate(0, 0.8);
        g.setColor(sil);
        g.fill(hill);
        g.setStroke(new BasicStroke(1.2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.draw(new Line2D.Float(7, 54, 7.5f, 42));
        g.setStroke(new BasicStroke(0.7f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.draw(new Line2D.Float(7.4f, 46, 3, 41));
        g.draw(new Line2D.Float(3.8f, 41.8f, 2.5f, 38.5f));
        g.draw(new Line2D.Float(7.5f, 44, 11.5f, 39.5f));
        g.draw(new Line2D.Float(10.4f, 40.6f, 12.5f, 40.8f));
        g.draw(new Line2D.Float(7.5f, 42, 6.5f, 37.5f));
        g.draw(new Line2D.Float(11.5f, 39.5f, 11.8f, 37));
        g.setStroke(new BasicStroke(0.5f));
        g.draw(new Line2D.Float(3, 41, 1.2f, 40.5f));
        g.fill(new RoundRectangle2D.Float(13, 50, 2.2f, 3.4f, 2, 2));
        g.fill(new RoundRectangle2D.Float(16.5f, 49.5f, 2.2f, 3.2f, 2, 2));
        g.fill(new Rectangle2D.Float(20.6f, 47.3f, 0.6f, 3.2f));
        g.fill(new Rectangle2D.Float(19.8f, 48.1f, 2.2f, 0.6f));
        g.fill(poly(27, 52, 27, 47, 30.5f, 43.5f, 34, 47, 34, 53));
        g.fill(new Rectangle2D.Float(32, 43.5f, 1.2f, 2.5f));
        float win = 0.75f + 0.25f * flicker(ph);
        glow(g, 30.5f, 49, 4.5f, new Color(255, 170, 60, (int) (110 * win)));
        g.setColor(new Color(255, (int) (180 + 40 * win), 90));
        g.fill(new Rectangle2D.Float(29.5f, 48, 2, 2));
        g.setColor(sil);
        g.fill(new Rectangle2D.Float(30.35f, 48, 0.3f, 2));
        g.fill(new Rectangle2D.Float(29.5f, 48.85f, 2, 0.3f));
        // bats: positions loop over the animation, wings flap
        int fr = Math.round(t * FRAMES);
        Color body = new Color(0x08030E);
        bat(g, -8 + t * (W + 16), 17 + (float) Math.sin(ph * 2) * 2.5f, 0, fr, body, new Color(0xFF5A3A));
        bat(g, W + 6 - ((t + 0.45f) % 1) * (W + 12), 33 + (float) Math.sin(ph * 2 + 1) * 2, 1, fr + 1, new Color(0x0E0618), new Color(0xFF8A3A));
        bat(g, -4 + ((t * 2 + 0.6f) % 1) * (W + 8), 6 + (float) Math.sin(ph * 4) * 1.2f, 2, fr + 2, new Color(0x1A0C2A), new Color(0xFFB060));
        bat(g, W + 4 - ((t * 2 + 0.15f) % 1) * (W + 8), 42 + (float) Math.cos(ph * 4) * 1.2f, 2, fr + 3, new Color(0x160A24), new Color(0xFFB060));
        frame(g, new Color(110, 60, 170, 190), new Color(255, 200, 120, 40));
    }

    // ---------------------------------------------------------------- Halloween: Pajęczyna

    /** Little spider hanging head-down: abdomen at (x, y), legs bent at the knees and wiggling by w. */
    private static void spider(Graphics2D g, float x, float y, float w) {
        g.setStroke(new BasicStroke(0.6f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(new Color(0x8C82A8));
        for (int side = -1; side <= 1; side += 2) {
            for (int i = 0; i < 4; i++) {
                float wig = (i % 2 == 0 ? w : -w) * side, out = i == 1 || i == 2 ? 0.8f : 0;
                Path2D leg = new Path2D.Float();
                leg.moveTo(x + side * 1.2f, y + 2.6f + i * 0.6f);
                leg.lineTo(x + side * (3.8f + out), y - 0.6f + i * 1.6f + wig);
                leg.lineTo(x + side * (5.4f + out - (i == 3 ? 1.2f : 0)), y - 2.6f + i * 3.6f + wig * 0.6f);
                g.draw(leg);
            }
        }
        g.setPaint(new RadialGradientPaint(x - 0.8f, y - 1, 3.4f, new float[]{0f, 1f}, new Color[]{new Color(0x6A5490), new Color(0x1E1628)}));
        g.fill(new Ellipse2D.Float(x - 2.2f, y - 2.4f, 4.4f, 5.2f));
        g.setColor(new Color(0x2A2036));
        g.fill(new Ellipse2D.Float(x - 1.5f, y + 2.2f, 3, 2.8f));
        g.setColor(new Color(0xFF8A1F));
        g.fill(new Rectangle2D.Float(x - 0.4f, y - 0.4f, 0.8f, 1.4f));
        g.setColor(new Color(0xFF4040));
        g.fill(new Rectangle2D.Float(x - 1, y + 4, 0.7f, 0.7f));
        g.fill(new Rectangle2D.Float(x + 0.3f, y + 4, 0.7f, 0.7f));
    }

    /** Point on the web around the corner (0,0): angle a in radians, radius r. */
    private static float[] webPt(double a, float r) {
        return new float[]{(float) Math.cos(a) * r, (float) Math.sin(a) * r};
    }

    /** Orb web radiating from a corner: spokes plus sagging spiral threads, optionally mirrored. */
    private static void orbWeb(Graphics2D g, float ox, float oy, float sx, float sy, double[] spokes, float[] rings, Color c, float w) {
        AffineTransform at = g.getTransform();
        g.translate(ox, oy);
        g.scale(sx, sy);
        g.setStroke(new BasicStroke(w, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(c);
        float max = rings[rings.length - 1] + 5;
        for (double a : spokes) {
            float[] p = webPt(a, max);
            g.draw(new Line2D.Float(0, 0, p[0], p[1]));
        }
        for (int k = 0; k < rings.length; k++) {
            for (int i = 0; i + 1 < spokes.length; i++) {
                float r1 = rings[k] * (1 + 0.04f * ((i * 7 + k * 3) % 3)), r2 = rings[k] * (1 + 0.04f * (((i + 1) * 7 + k * 3) % 3));
                float[] a = webPt(spokes[i], r1), b = webPt(spokes[i + 1], r2), m = webPt((spokes[i] + spokes[i + 1]) / 2, (r1 + r2) / 2 * 0.86f);
                Path2D p = new Path2D.Float();
                p.moveTo(a[0], a[1]);
                p.quadTo(m[0], m[1], b[0], b[1]);
                g.draw(p);
            }
        }
        g.setTransform(at);
    }

    /** A silver web in the corner, dew drops glinting and a little spider slowly lowering itself on a thread. */
    private static void web(Graphics2D g, float t) {
        double ph = t * Math.PI * 2;
        g.setPaint(new LinearGradientPaint(0, 0, 0, H, new float[]{0f, 0.6f, 1f},
                new Color[]{new Color(0x1C1A26), new Color(0x110F18), new Color(0x08070C)}));
        g.fillRect(0, 0, W, H);
        // cold moonlight from the upper right and a low mist
        glow(g, 38, 4, 30, new Color(120, 140, 200, 55));
        for (int i = 0; i < 3; i++) {
            float mxp = ((t + i / 3f) % 1) * (W + 30) - 30;
            g.setPaint(new RadialGradientPaint(mxp + 15, 60 - i * 2.5f, 16, new float[]{0f, 1f},
                    new Color[]{new Color(150, 130, 190, 45), new Color(150, 130, 190, 0)}));
            g.fill(new Rectangle2D.Float(mxp - 5, 40, 40, 24));
        }
        // the big web in the top-left corner and a small one at the bottom right
        double[] spokes = new double[8];
        for (int i = 0; i < spokes.length; i++) spokes[i] = Math.toRadians(2 + i * 12.3 + (i % 2) * 1.5);
        float[] rings = {5.5f, 10.5f, 16, 22, 28.5f, 35.5f};
        orbWeb(g, 0, 0, 1, 1, spokes, rings, new Color(214, 222, 238, 200), 0.5f);
        double[] small = new double[6];
        for (int i = 0; i < small.length; i++) small[i] = Math.toRadians(4 + i * 16.4);
        float[] sRings = {4, 8, 12.5f};
        orbWeb(g, W, H, -1, -1, small, sRings, new Color(190, 198, 220, 100), 0.45f);
        // a loose broken strand
        g.setStroke(new BasicStroke(0.45f));
        g.setColor(new Color(200, 205, 225, 120));
        Path2D strand = new Path2D.Float();
        strand.moveTo(35.5f, 0);
        strand.quadTo(36.5f + (float) Math.sin(ph) * 0.8f, 6, 35 + (float) Math.sin(ph + 1) * 1.2f, 11);
        g.draw(strand);
        // a light glint running out along one spoke
        float[] gp = webPt(spokes[4], 4 + t * 40);
        if (gp[1] < H) glow(g, gp[0], gp[1], 2.5f, new Color(230, 240, 255, (int) (170 * (1 - t))));
        // dew drops on the threads, each glinting in turn
        int[][] drops = {{1, 2}, {3, 1}, {2, 3}, {5, 2}, {4, 4}, {6, 3}, {0, 4}, {2, 5}, {5, 5}, {6, 1}};
        for (int i = 0; i < drops.length; i++) {
            int s = drops[i][0], k = drops[i][1];
            float[] p = webPt((spokes[s] + spokes[s + 1]) / 2, rings[k] * 0.87f);
            if (p[0] > W - 2 || p[1] > H - 2) continue;
            g.setColor(new Color(150, 200, 240, 230));
            g.fill(new Ellipse2D.Float(p[0] - 0.85f, p[1] - 0.7f, 1.7f, 1.7f));
            g.setColor(new Color(245, 252, 255));
            g.fill(new Rectangle2D.Float(p[0] - 0.5f, p[1] - 0.5f, 0.6f, 0.6f));
            float gl = (float) Math.max(0, Math.cos(ph * 3 - i * Math.PI * 2 * 3 / drops.length));
            gl *= gl * gl * gl;
            if (gl > 0.05f) {
                glow(g, p[0], p[1], 3f, new Color(200, 230, 255, (int) (160 * gl)));
                sparkle(g, p[0], p[1], 0.8f + 2f * gl, new Color(255, 255, 255, (int) (235 * gl)));
            }
        }
        // the spider: lowers itself slowly, then scurries back up the thread
        float k = t < 0.75f ? t / 0.75f : 1 - (t - 0.75f) / 0.25f;
        k = k * k * (3 - 2 * k);
        float ax = 27.5f, ay = 9.5f;
        float sx = ax + (float) Math.sin(ph * 2) * 0.6f * k, sy = 22 + 22 * k;
        g.setStroke(new BasicStroke(0.45f));
        g.setColor(new Color(225, 230, 245, 210));
        g.draw(new Line2D.Float(ax, ay, sx, sy - 2.4f));
        spider(g, sx, sy, Math.round(t * FRAMES) % 2 == 0 ? 0.6f : -0.6f);
        frame(g, new Color(150, 156, 180, 150), new Color(255, 255, 255, 20));
    }

    // ---------------------------------------------------------------- classic

    private static void classic(Graphics2D g, int idx) {
        Color a = new Color(COLORS[idx][0]), b = new Color(COLORS[idx][1]);
        g.setPaint(new GradientPaint(0, 0, a, 0, H, b));
        g.fillRect(0, 0, W, H);
        if (NAMES[idx].equals("Galaxy")) {
            Random r = new Random(7);
            for (int i = 0; i < 70; i++) {
                g.setColor(new Color(255, 255, 255, 80 + r.nextInt(170)));
                int x = r.nextInt(W), y = r.nextInt(H), d = 1 + r.nextInt(3);
                g.fillOval(x, y, d, d);
            }
        }
        // stylised "N" emblem
        g.setColor(new Color(255, 255, 255, 215));
        int ex = W / 2 - 3 * S / 2 - S, ey = 5 * S, eh = 6 * S;
        g.fillRect(ex, ey, S, eh);
        g.fillRect(ex + 3 * S, ey, S, eh);
        g.fillPolygon(new int[]{ex + S, ex + 2 * S, ex + 3 * S, ex + 2 * S}, new int[]{ey, ey, ey + eh, ey + eh}, 4);
        g.setColor(new Color(255, 255, 255, 60));
        g.drawRect(0, 0, W - 1, H - 1);
    }

    // ---------------------------------------------------------------- drawing helpers

    private static void glow(Graphics2D g, float x, float y, float r, Color c) {
        g.setPaint(new RadialGradientPaint(x, y, r, new float[]{0f, 1f},
                new Color[]{c, new Color(c.getRed(), c.getGreen(), c.getBlue(), 0)}));
        g.fill(new Ellipse2D.Float(x - r, y - r, r * 2, r * 2));
    }

    /** Thin outer border plus a soft inner one. */
    private static void frame(Graphics2D g, Color outer, Color inner) {
        g.setStroke(new BasicStroke(1f));
        g.setColor(outer);
        g.draw(new Rectangle2D.Float(0.5f, 0.5f, W - 1, H - 1));
        g.setColor(inner);
        g.draw(new Rectangle2D.Float(1.5f, 1.5f, W - 3, H - 3));
    }

    private static void brackets(Graphics2D g, float x, float y, float w, float h, float len, float t) {
        float r = x + w, b = y + h;
        g.fill(new Rectangle2D.Float(x, y, len, t));
        g.fill(new Rectangle2D.Float(x, y, t, len));
        g.fill(new Rectangle2D.Float(r - len, y, len, t));
        g.fill(new Rectangle2D.Float(r - t, y, t, len));
        g.fill(new Rectangle2D.Float(x, b - t, len, t));
        g.fill(new Rectangle2D.Float(x, b - len, t, len));
        g.fill(new Rectangle2D.Float(r - len, b - t, len, t));
        g.fill(new Rectangle2D.Float(r - t, b - len, t, len));
    }

    private static void dashed(Graphics2D g, float x, float y, float w, float h) {
        for (float i = x + 1; i < x + w - 1; i += 2) {
            g.fill(new Rectangle2D.Float(i, y, 1, 0.5f));
            g.fill(new Rectangle2D.Float(i, y + h - 0.5f, 1, 0.5f));
        }
        for (float i = y + 1; i < y + h - 1; i += 2) {
            g.fill(new Rectangle2D.Float(x, i, 0.5f, 1));
            g.fill(new Rectangle2D.Float(x + w - 0.5f, i, 0.5f, 1));
        }
    }

    /** Minecraft-like block: gradient face, light top-left bevel and dark bottom-right bevel. */
    private static void block(Graphics2D g, float x, float y, float s, Color light, Color dark) {
        g.setPaint(new GradientPaint(x, y, light, x + s, y + s, dark));
        g.fill(new Rectangle2D.Float(x, y, s, s));
        g.setColor(new Color(255, 255, 255, 120));
        g.fill(new Rectangle2D.Float(x, y, s, 0.75f));
        g.fill(new Rectangle2D.Float(x, y, 0.75f, s));
        g.setColor(new Color(60, 20, 0, 120));
        g.fill(new Rectangle2D.Float(x, y + s - 0.75f, s, 0.75f));
        g.fill(new Rectangle2D.Float(x + s - 0.75f, y, 0.75f, s));
    }

    /** Inventory slot with the vanilla bevel. */
    private static void slot(Graphics2D g, float x, float y, float s) {
        g.setColor(new Color(0x3B2A22));
        g.fill(new Rectangle2D.Float(x, y, s, s));
        g.setColor(new Color(0x170E0A));
        g.fill(new Rectangle2D.Float(x, y, s, 0.75f));
        g.fill(new Rectangle2D.Float(x, y, 0.75f, s));
        g.setColor(new Color(0x6A4C3C));
        g.fill(new Rectangle2D.Float(x, y + s - 0.75f, s, 0.75f));
        g.fill(new Rectangle2D.Float(x + s - 0.75f, y, 0.75f, s));
    }

    private static void ingot(Graphics2D g, float x, float y) {
        Path2D p = new Path2D.Float();
        p.moveTo(x + 1.5f, y);
        p.lineTo(x + 6, y);
        p.lineTo(x + 6, y + 3);
        p.lineTo(x, y + 3);
        p.closePath();
        g.setPaint(new GradientPaint(x, y, new Color(0xF4F4F4), x, y + 3, new Color(0x9A9A9A)));
        g.fill(p);
        g.setColor(new Color(255, 255, 255, 200));
        g.fill(new Rectangle2D.Float(x + 1.75f, y + 0.5f, 3.5f, 0.6f));
    }

    private static void stick(Graphics2D g, float x, float y) {
        g.setColor(new Color(0x8A5A2B));
        for (int i = 0; i < 6; i++) g.fill(new Rectangle2D.Float(x + 5 - i, y + i, 1, 1));
        g.setColor(new Color(0x5A3416));
        for (int i = 0; i < 5; i++) g.fill(new Rectangle2D.Float(x + 5 - i, y + i + 1, 0.5f, 0.5f));
    }

    private static final String[] PICKAXE = {
            "..HHH...",
            ".....HH.",
            ".....SH.",
            "....S..H",
            "...S...H",
            "..S....H",
            ".S......",
            "S......."};

    /** Red-hot pickaxe, 8x8 pixels of size p. */
    private static void pickaxe(Graphics2D g, float x, float y, float p) {
        for (int row = 0; row < 8; row++) {
            for (int col = 0; col < 8; col++) {
                char c = PICKAXE[row].charAt(col);
                if (c == '.') continue;
                g.setColor(c == 'H' ? (row + col < 7 ? new Color(0xFFF3B0) : new Color(0xFFB13B)) : new Color(0x7A4320));
                g.fill(new Rectangle2D.Float(x + col * p, y + row * p, p, p));
            }
        }
    }

    /** Flame tongue rising from (x, base). */
    private static void flame(Graphics2D g, float x, float base, float w, float h, Color c) {
        Path2D p = new Path2D.Float();
        p.moveTo(x, base);
        p.quadTo(x - w * 0.1f, base - h * 0.55f, x + w * 0.5f, base - h);
        p.quadTo(x + w * 0.45f, base - h * 0.5f, x + w * 0.85f, base - h * 0.35f);
        p.quadTo(x + w * 1.1f, base - h * 0.15f, x + w, base);
        p.closePath();
        g.setPaint(new GradientPaint(0, base, new Color(255, 236, 160, 230), 0, base - h, new Color(c.getRed(), c.getGreen(), c.getBlue(), 0)));
        g.fill(p);
    }

    private static void aurora(Graphics2D g, float y, float amp, float freq, float phase, Color c, int alpha) {
        Path2D p = new Path2D.Float();
        p.moveTo(0, y + 6);
        for (int x = 0; x <= W; x++) p.lineTo(x, y + (float) Math.sin(x * freq + phase) * amp);
        for (int x = W; x >= 0; x--) p.lineTo(x, y + 6 + (float) Math.sin(x * freq + 1 + phase) * amp * 0.5f);
        p.closePath();
        g.setPaint(new GradientPaint(0, y - amp, new Color(c.getRed(), c.getGreen(), c.getBlue(), alpha), 0, y + 6 + amp,
                new Color(c.getRed(), c.getGreen(), c.getBlue(), 0)));
        g.fill(p);
    }

    /** A bright spark running once around the frame per loop. */
    private static void spark(Graphics2D g, float t, Color c) {
        float per = 2 * (W + H), d = t * per, x, y;
        if (d < W) { x = d; y = 0.5f; }
        else if (d < W + H) { x = W - 0.5f; y = d - W; }
        else if (d < 2 * W + H) { x = W - (d - W - H); y = H - 0.5f; }
        else { x = 0.5f; y = H - (d - 2 * W - H); }
        glow(g, x, y, 4, new Color(c.getRed(), c.getGreen(), c.getBlue(), 200));
        g.setColor(Color.WHITE);
        g.fill(new Ellipse2D.Float(x - 0.75f, y - 0.75f, 1.5f, 1.5f));
    }

    private static Color mix(Color a, Color b, float k) {
        return new Color((int) (a.getRed() + (b.getRed() - a.getRed()) * k), (int) (a.getGreen() + (b.getGreen() - a.getGreen()) * k),
                (int) (a.getBlue() + (b.getBlue() - a.getBlue()) * k), (int) (a.getAlpha() + (b.getAlpha() - a.getAlpha()) * k));
    }

    /** Four-point star. */
    private static void sparkle(Graphics2D g, float x, float y, float r, Color c) {
        Path2D p = new Path2D.Float();
        p.moveTo(x, y - r);
        p.quadTo(x, y, x + r, y);
        p.quadTo(x, y, x, y + r);
        p.quadTo(x, y, x - r, y);
        p.quadTo(x, y, x, y - r);
        p.closePath();
        g.setColor(c);
        g.fill(p);
    }

    private static final Map<Character, String[]> FONT = new HashMap<Character, String[]>();

    static {
        FONT.put('0', new String[]{"111", "101", "101", "101", "111"});
        FONT.put('1', new String[]{"010", "110", "010", "010", "111"});
        FONT.put('2', new String[]{"111", "001", "111", "100", "111"});
        FONT.put('4', new String[]{"101", "101", "111", "001", "001"});
        FONT.put('.', new String[]{"0", "0", "0", "0", "1"});
        FONT.put('β', new String[]{"110", "101", "110", "101", "110", "100"});
    }

    /** Tiny pixel font centred on cx, with an optional drop shadow. */
    private static void pixelText(Graphics2D g, String text, float cx, float y, float p, Color c, boolean shadow) {
        float w = -p;
        for (char ch : text.toCharArray()) w += (FONT.get(ch)[0].length() + 1) * p;
        float x = cx - w / 2;
        if (shadow) drawPixels(g, text, x + p * 0.5f, y + p * 0.5f, p, new Color(0, 0, 0, 160));
        drawPixels(g, text, x, y, p, c);
    }

    private static void drawPixels(Graphics2D g, String text, float x, float y, float p, Color c) {
        g.setColor(c);
        for (char ch : text.toCharArray()) {
            String[] rows = FONT.get(ch);
            for (int r = 0; r < rows.length; r++)
                for (int col = 0; col < rows[r].length(); col++)
                    if (rows[r].charAt(col) == '1') g.fill(new Rectangle2D.Float(x + col * p, y + r * p, p, p));
            x += (rows[0].length() + 1) * p;
        }
    }
}
