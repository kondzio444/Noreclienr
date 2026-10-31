package dev.noreclient.util;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Platform;
import dev.noreclient.api.TextureRef;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * "Wiśniowy staw" menu background: a real Minecraft scene (cherry grove with a pond) captured as a
 * 360° cylindrical strip for three times of day. The camera slowly turns around (the strip pans and
 * wraps), follows the mouse a little, and the times of day cross-fade; pink petals drift over it.
 * Works the same on every version because it only draws textures.
 */
public final class MenuPanorama {
    public static final String[] TIMES = {"day", "sunset", "night"};
    private static final Map<String, Object> TEX = new ConcurrentHashMap<String, Object>();
    private static final Map<String, byte[]> READY = new ConcurrentHashMap<String, byte[]>();
    private static final long START = System.currentTimeMillis();
    private static final float[][] PETALS = new float[42][4];

    static {
        java.util.Random r = new java.util.Random(11);
        for (float[] p : PETALS) { p[0] = r.nextFloat(); p[1] = r.nextFloat(); p[2] = 0.4f + r.nextFloat() * 0.6f; p[3] = r.nextFloat() * 6.28f; }
    }

    private MenuPanorama() {}

    /** Texture of one strip (loaded and decoded in the background on first use; null until ready). */
    private static TextureRef strip(String time) {
        Object o = TEX.get(time);
        if (o instanceof TextureRef) return (TextureRef) o;
        byte[] png = READY.remove(time);
        if (png != null) {
            TextureRef t = Platform.game().loadTexture("panorama/cherry_" + time, png);
            TEX.put(time, t == null ? Boolean.FALSE : t);
            return t;
        }
        if (o == null) {
            TEX.put(time, "loading");
            Thread th = new Thread(() -> {
                try (InputStream in = MenuPanorama.class.getResourceAsStream("/assets/noreclient/panorama/cherry_" + time + ".jpg")) {
                    if (in == null) { TEX.put(time, Boolean.FALSE); return; }
                    System.setProperty("java.awt.headless", "true");
                    BufferedImage img = javax.imageio.ImageIO.read(in);
                    BufferedImage rgb = new BufferedImage(img.getWidth(), img.getHeight(), BufferedImage.TYPE_INT_ARGB);
                    rgb.getGraphics().drawImage(img, 0, 0, null);
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    javax.imageio.ImageIO.write(rgb, "png", out);
                    READY.put(time, out.toByteArray());
                } catch (Exception e) {
                    TEX.put(time, Boolean.FALSE);
                }
            }, "Nore panorama");
            th.setDaemon(true);
            th.setPriority(Thread.MIN_PRIORITY);
            th.start();
        }
        return null;
    }

    /** True when at least the daytime strip is bundled. */
    public static boolean available() {
        return MenuPanorama.class.getResource("/assets/noreclient/panorama/cherry_day.jpg") != null;
    }

    /** Weights of day / sunset / night for minutes after midnight (smooth cross-fades). */
    static float[] weights(float min) {
        float day, sunset, night;
        if (min < 300 || min >= 1260) { day = 0; sunset = 0; night = 1; }
        else if (min < 420) { float t = (min - 300) / 120f; night = 1 - t; sunset = t; day = 0; }
        else if (min < 540) { float t = (min - 420) / 120f; sunset = 1 - t; day = t; night = 0; }
        else if (min < 1020) { day = 1; sunset = 0; night = 0; }
        else if (min < 1140) { float t = (min - 1020) / 120f; day = 1 - t; sunset = t; night = 0; }
        else { float t = (min - 1140) / 120f; sunset = 1 - t; night = t; day = 0; }
        return new float[]{day, sunset, night};
    }

    private static float parX;

    /** Draws the panorama filling (0,0)-(w,h). Returns false when nothing could be drawn yet. */
    public static boolean render(Gfx g, int w, int h, float minutes, int mouseX) {
        double t = (System.currentTimeMillis() - START) / 1000.0;
        parX += ((mouseX / (float) Math.max(1, w) - 0.5f) - parX) * 0.04f;
        float[] wt = weights(minutes);
        boolean drew = false;
        for (int i = 0; i < TIMES.length; i++) {
            if (wt[i] <= 0.001f) continue;
            TextureRef tex = strip(TIMES[i]);
            if (tex == null && i != 0) tex = strip(TIMES[0]); // a missing time falls back to day
            if (tex == null) continue;
            float sh = h * 1.12f, sw = sh * tex.width / (float) tex.height;
            float off = (float) ((t * 7.0 + parX * 60) % sw);
            if (off < 0) off += sw;
            float y = (h - sh) / 2f - 0.02f * h;
            float alpha = drew ? wt[i] : 1f;
            for (float x = -off; x < w; x += sw) g.texture(tex, x, y, sw, sh, alpha);
            drew = true;
        }
        if (!drew) return false;
        // soft violet grade + falling cherry petals
        Render2D.quadGradient(g, 0, 0, w, h, ColorUtil.withAlpha(Theme.accent(), 26), 0x00000000, ColorUtil.withAlpha(Theme.accent2(), 20), 0x00000000);
        for (float[] p : PETALS) {
            float px = (float) (((p[0] + t * 0.012 * p[2] + Math.sin(t * 0.7 + p[3]) * 0.01) % 1.0) * w);
            float py = (float) (((p[1] + t * 0.03 * p[2]) % 1.0) * (h + 10)) - 5;
            float s = 1.2f + p[2] * 1.6f;
            int a = (int) (120 + 120 * p[2]);
            Render2D.rect(g, px, py, s, s * 0.7f, ColorUtil.withAlpha(0xFFFFC4E1, a));
            Render2D.rect(g, px + s * 0.3f, py - s * 0.2f, s * 0.5f, s * 0.4f, ColorUtil.withAlpha(0xFFF38BB8, a));
        }
        return true;
    }
}
