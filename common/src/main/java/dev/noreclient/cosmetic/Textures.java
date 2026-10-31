package dev.noreclient.cosmetic;

import dev.noreclient.api.Platform;
import dev.noreclient.api.TextureRef;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Item textures per (item, variant, colour), painted on a background thread and uploaded on the
 * render thread. Items with a glow option get an atlas twice as tall: base on top, glow mask below.
 * Every item reuses a small pool of texture names, so picking colours never piles up GPU textures.
 * A small downscaled copy of each atlas is kept for the software previews ({@link Mini3D}).
 */
final class Textures {
    private static final int POOL = 6;
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Nore wardrobe painter");
        t.setDaemon(true);
        t.setPriority(Thread.MIN_PRIORITY);
        return t;
    });

    /** A painted atlas: PNG waiting for upload, and a small ARGB copy for sampling. */
    static final class Atlas {
        byte[] png;
        int[] small;
        int sw, sh;
        TextureRef tex;
        int poolSlot = -1;
    }

    private static final Map<String, Atlas> READY = new ConcurrentHashMap<String, Atlas>();
    private static final Map<String, Boolean> PENDING = new ConcurrentHashMap<String, Boolean>();
    /** Uploaded atlases, most recently used last (render thread only). */
    private static final LinkedHashMap<String, Atlas> LIVE = new LinkedHashMap<String, Atlas>(16, 0.75f, true);
    private static final Map<String, boolean[]> POOLS = new HashMap<String, boolean[]>();
    private static int uploadsThisFrame;
    private static long frame;

    private Textures() {}

    static String key(Item item, Worn w) {
        return item.id + "/" + (item.variants.length > 0 ? w.variant : "") + "/" + (item.colorOption ? Integer.toHexString(w.color) : "");
    }

    /** True when the item's texture has a glow half. */
    static boolean atlas(Item item) { return item.glowOption; }

    /** The atlas for this frame, or null while it is still being painted (render thread). */
    static Atlas get(Item item, Worn w) {
        String key = key(item, w);
        Atlas a = LIVE.get(key);
        if (a != null && a.tex != null) return a;
        Atlas ready = READY.get(key);
        if (ready != null) {
            long now = System.nanoTime() / 16_000_000L;
            if (now != frame) { frame = now; uploadsThisFrame = 0; }
            if (uploadsThisFrame >= 2) return null;
            uploadsThisFrame++;
            READY.remove(key);
            int slot = claim(item.id);
            ready.poolSlot = slot;
            ready.tex = Platform.game().loadTexture("wardrobe/" + item.id + "_" + slot, ready.png);
            ready.png = null;
            if (ready.tex == null) return null;
            LIVE.put(key, ready);
            return ready;
        }
        request(item, w, key);
        return null;
    }

    /** Small sampling copy, also available before upload; null while painting. */
    static Atlas peek(Item item, Worn w) {
        String key = key(item, w);
        Atlas a = LIVE.get(key);
        if (a != null) return a;
        a = READY.get(key);
        if (a != null) return a;
        request(item, w, key);
        return null;
    }

    /** Takes a free name from the item's pool, evicting its least recently used atlas when all are taken. */
    private static int claim(String itemId) {
        boolean[] used = POOLS.get(itemId);
        if (used == null) POOLS.put(itemId, used = new boolean[POOL]);
        for (int i = 0; i < POOL; i++) if (!used[i]) { used[i] = true; return i; }
        for (java.util.Iterator<Map.Entry<String, Atlas>> it = LIVE.entrySet().iterator(); it.hasNext(); ) {
            Map.Entry<String, Atlas> e = it.next();
            if (e.getKey().startsWith(itemId + "/")) {
                it.remove();
                return e.getValue().poolSlot; // re-registering the name replaces the old texture
            }
        }
        return 0;
    }

    private static void request(final Item item, final Worn w, final String key) {
        if (PENDING.putIfAbsent(key, Boolean.TRUE) != null) return;
        WORKER.execute(() -> {
            try {
                Atlas a = paint(item, w.color, w.variant);
                if (a != null) READY.put(key, a);
            } catch (Throwable t) {
                dev.noreclient.NoreClient.LOGGER.warning("Wardrobe texture " + key + " failed: " + t);
            } finally {
                PENDING.remove(key);
            }
        });
    }

    static Atlas paint(Item item, int color, String variant) {
        System.setProperty("java.awt.headless", "true");
        BufferedImage base = item.paint(color, variant);
        if (base == null) return null;
        BufferedImage img = base;
        if (atlas(item)) {
            BufferedImage glow = item.paintGlow(color, variant);
            img = new BufferedImage(base.getWidth(), base.getHeight() * 2, BufferedImage.TYPE_INT_ARGB);
            Graphics2D g = img.createGraphics();
            g.drawImage(base, 0, 0, null);
            g.setColor(java.awt.Color.BLACK);
            g.fillRect(0, base.getHeight(), base.getWidth(), base.getHeight());
            if (glow != null) g.drawImage(glow, 0, base.getHeight(), null);
            g.dispose();
            // the glow half also works with translucent (not additive) glow pipelines: black becomes
            // transparent and every pixel is as opaque as it is bright
            int w = img.getWidth(), h0 = base.getHeight();
            int[] px = img.getRGB(0, h0, w, h0, null, 0, w);
            for (int i = 0; i < px.length; i++) {
                int c = px[i], r = (c >> 16) & 255, gg = (c >> 8) & 255, b = c & 255;
                int a = Math.max(r, Math.max(gg, b)) * ((c >>> 24) & 255) / 255;
                px[i] = a << 24 | (c & 0xFFFFFF);
            }
            img.setRGB(0, h0, w, h0, px, 0, w);
        }
        Atlas a = new Atlas();
        a.png = png(img);
        a.sw = Math.max(1, Math.min(96, img.getWidth()));
        a.sh = Math.max(1, img.getHeight() * a.sw / img.getWidth());
        BufferedImage small = new BufferedImage(a.sw, a.sh, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = small.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(img, 0, 0, a.sw, a.sh, null);
        g.dispose();
        a.small = small.getRGB(0, 0, a.sw, a.sh, null, 0, a.sw);
        return a.png == null ? null : a;
    }

    static byte[] png(BufferedImage img) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            javax.imageio.ImageIO.write(img, "png", out);
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }
}
