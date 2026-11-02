package dev.noreclient.util;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Platform;
import dev.noreclient.api.TextureRef;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Scaled-down PNG textures of image files (screenshots), made in the background and cached. */
public final class Thumbnails {
    private static final ExecutorService POOL = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "Nore-Thumbnails");
        t.setDaemon(true);
        return t;
    });
    private static final Object LOADING = new Object(), FAILED = new Object();
    private static final Map<String, Object> CACHE = new LinkedHashMap<String, Object>(64, 0.75f, true);

    private Thumbnails() {}

    /** Texture of the file scaled to at most maxW pixels wide; null while loading. */
    public static TextureRef get(final File file, final int maxW) {
        final String key = file.getAbsolutePath() + "|" + file.lastModified() + "|" + maxW;
        synchronized (CACHE) {
            Object o = CACHE.get(key);
            if (o instanceof TextureRef) return (TextureRef) o;
            if (o != null) return null;
            CACHE.put(key, LOADING);
        }
        POOL.execute(() -> {
            try {
                System.setProperty("java.awt.headless", "true");
                java.awt.image.BufferedImage src = javax.imageio.ImageIO.read(file);
                if (src == null) throw new IllegalStateException();
                float scale = Math.min(1f, maxW / (float) src.getWidth());
                int w = Math.max(1, Math.round(src.getWidth() * scale)), h = Math.max(1, Math.round(src.getHeight() * scale));
                java.awt.image.BufferedImage out = new java.awt.image.BufferedImage(w, h, java.awt.image.BufferedImage.TYPE_INT_RGB);
                java.awt.Graphics2D g = out.createGraphics();
                g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                g.drawImage(src, 0, 0, w, h, null);
                g.dispose();
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                javax.imageio.ImageIO.write(out, "png", bytes);
                final byte[] png = bytes.toByteArray();
                NoreClient.runNextTick(() -> {
                    TextureRef t = Platform.game().loadTexture("thumb/" + Integer.toHexString(key.hashCode()), png);
                    synchronized (CACHE) { CACHE.put(key, t == null ? FAILED : t); }
                });
            } catch (Throwable t) {
                synchronized (CACHE) { CACHE.put(key, FAILED); }
            }
        });
        return null;
    }

    /** True when the thumbnail could not be made (broken file). */
    public static boolean failed(File file, int maxW) {
        synchronized (CACHE) { return CACHE.get(file.getAbsolutePath() + "|" + file.lastModified() + "|" + maxW) == FAILED; }
    }
}
