package dev.noreclient.util;

import dev.noreclient.api.Platform;
import dev.noreclient.api.TextureRef;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Textures shipped inside the mod jar (assets/noreclient/textures/gui). They are read straight
 * from the classpath and registered at runtime, so they work without a mod resource loader on
 * every Minecraft version. Call from the render thread.
 */
public final class BundledTextures {
    private static final Map<String, TextureRef> CACHE = new HashMap<String, TextureRef>();

    private BundledTextures() {}

    public static TextureRef logo() { return get("logo"); }

    public static TextureRef background() { return get("background"); }

    public static TextureRef get(String name) {
        if (CACHE.containsKey(name)) return CACHE.get(name);
        TextureRef ref = null;
        InputStream in = BundledTextures.class.getResourceAsStream("/assets/noreclient/textures/gui/" + name + ".png");
        if (in != null) {
            try {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                in.close();
                ref = Platform.game().loadTexture("gui/" + name, out.toByteArray());
            } catch (Exception ignored) {
                // leave null: callers skip drawing
            }
        }
        CACHE.put(name, ref);
        return ref;
    }
}
