package dev.noreclient.util;

import dev.noreclient.api.Platform;
import dev.noreclient.api.TextureRef;

import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import java.util.Map;

/** Nore capes drawn in code (64x32 cape layout, 4x resolution) – no image files needed. */
public final class Capes {
    public static final String[] NAMES = {"Brak", "Nore Orange", "Ember", "Violet", "Ocean", "Emerald", "Sakura", "Gold", "Ice", "Beta 1.4", "Galaxy"};
    private static final int[][] COLORS = {
            {0, 0}, {0xFFB547, 0xFF5A1A}, {0xFF6B2C, 0x5A0E00}, {0xC9A4FF, 0x5B2BD6}, {0x7FD0FF, 0x1A4DFF}, {0x8AF0C0, 0x0E7A52},
            {0xFFADD9, 0xC12E86}, {0xFFE08A, 0xD68A00}, {0xE6FAFF, 0x3CB8E0}, {0xFF8A1F, 0x241A14}, {0x8A5CFF, 0x0A0820}};
    private static final Map<String, TextureRef> CACHE = new HashMap<String, TextureRef>();

    private Capes() {}

    /** Texture of the named cape (render thread); null for "Brak". */
    public static TextureRef texture(String name) {
        if (name == null || name.equals(NAMES[0])) return null;
        TextureRef t = CACHE.get(name);
        if (t == null) {
            byte[] png = png(name);
            if (png == null) return null;
            t = Platform.game().loadTexture("cape/" + name.toLowerCase().replaceAll("[^a-z0-9]", "_"), png);
            if (t != null) CACHE.put(name, t);
        }
        return t;
    }

    private static final Map<String, TextureRef> PREVIEWS = new HashMap<String, TextureRef>();

    /** Only the front of the cape (for the cosmetics menu). */
    public static TextureRef preview(String name) {
        if (name == null || name.equals(NAMES[0])) return null;
        TextureRef t = PREVIEWS.get(name);
        if (t == null) {
            byte[] full = png(name);
            if (full == null) return null;
            try {
                java.awt.image.BufferedImage img = javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(full));
                java.awt.image.BufferedImage front = img.getSubimage(4, 4, 40, 64);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                javax.imageio.ImageIO.write(front, "png", out);
                t = Platform.game().loadTexture("capeprev/" + name.toLowerCase().replaceAll("[^a-z0-9]", "_"), out.toByteArray());
                if (t != null) PREVIEWS.put(name, t);
            } catch (Exception e) {
                return null;
            }
        }
        return t;
    }

    static byte[] png(String name) {
        int idx = 0;
        for (int i = 0; i < NAMES.length; i++) if (NAMES[i].equals(name)) idx = i;
        if (idx == 0) return null;
        int s = 4; // 256x128
        BufferedImage img = new BufferedImage(64 * s, 32 * s, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(java.awt.RenderingHints.KEY_ANTIALIASING, java.awt.RenderingHints.VALUE_ANTIALIAS_ON);
        Color a = new Color(COLORS[idx][0]), b = new Color(COLORS[idx][1]);
        // whole cape area: front (1,1 10x16), back (12,1 10x16), sides and top/bottom
        g.setPaint(new GradientPaint(0, 0, b.darker(), 0, 17 * s, b));
        g.fillRect(0, 0, 22 * s, 17 * s);
        // elytra area (34..46 x 2..22) gets the same colours
        g.setPaint(new GradientPaint(0, 0, a, 0, 22 * s, b));
        g.fillRect(34 * s, 0, 12 * s, 22 * s);
        // front face
        int fx = s, fy = s, fw = 10 * s, fh = 16 * s;
        g.setPaint(new GradientPaint(0, fy, a, 0, fy + fh, b));
        g.fillRect(fx, fy, fw, fh);
        if (name.equals("Galaxy")) {
            java.util.Random r = new java.util.Random(7);
            for (int i = 0; i < 70; i++) {
                g.setColor(new Color(255, 255, 255, 80 + r.nextInt(170)));
                int x = fx + r.nextInt(fw), y = fy + r.nextInt(fh), d = 1 + r.nextInt(3);
                g.fillOval(x, y, d, d);
            }
        }
        // stylised "N" emblem
        g.setColor(new Color(255, 255, 255, 215));
        int ex = fx + fw / 2 - 3 * s / 2 - s, ey = fy + 5 * s, eh = 6 * s;
        g.fillRect(ex, ey, s, eh);
        g.fillRect(ex + 3 * s, ey, s, eh);
        int[] xs = {ex + s, ex + 2 * s, ex + 3 * s, ex + 2 * s};
        int[] ys = {ey, ey, ey + eh, ey + eh};
        g.fillPolygon(xs, ys, 4);
        // border glow
        g.setColor(new Color(255, 255, 255, 60));
        g.drawRect(fx, fy, fw - 1, fh - 1);
        if (name.equals("Beta 1.4")) {
            g.setColor(new Color(0xFF8A1F));
            g.fillRect(fx, fy + fh - 3 * s, fw, s);
        }
        g.dispose();
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            System.setProperty("java.awt.headless", "true");
            javax.imageio.ImageIO.write(img, "png", out);
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }
}
