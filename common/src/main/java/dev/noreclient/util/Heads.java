package dev.noreclient.util;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Platform;
import dev.noreclient.api.TextureRef;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Player head textures (mc-heads.net), loaded in the background. */
public final class Heads {
    private static final Map<String, Object> CACHE = new ConcurrentHashMap<String, Object>();

    private Heads() {}

    public static TextureRef get(final String name) {
        if (name == null || !name.matches("[A-Za-z0-9_]{2,16}")) return null;
        final String key = name.toLowerCase();
        Object o = CACHE.get(key);
        if (o instanceof TextureRef) return (TextureRef) o;
        if (o != null) return null;
        CACHE.put(key, "loading");
        Thread t = new Thread(() -> {
            try {
                final byte[] png = Modrinth.getBytes("https://mc-heads.net/avatar/" + name + "/32");
                NoreClient.runNextTick(() -> {
                    TextureRef tex = Platform.game().loadTexture("head/" + key, png);
                    CACHE.put(key, tex == null ? Boolean.FALSE : tex);
                });
            } catch (Throwable e) {
                CACHE.put(key, Boolean.FALSE);
            }
        }, "Nore-Head");
        t.setDaemon(true);
        t.start();
        return null;
    }
}
