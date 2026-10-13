package dev.noreclient.util;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import dev.noreclient.NoreClient;
import dev.noreclient.api.Platform;
import dev.noreclient.api.TextureRef;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

/** Tiny async Modrinth API client used by the in-game content browser (Java 8 compatible). */
public final class Modrinth {
    private static final String API = "https://api.modrinth.com/v2";
    private static final String UA = "NoreClient/" + NoreClient.VERSION + " (github.com/kondzio444/Noreclienr)";
    private static final ExecutorService POOL = Executors.newFixedThreadPool(4, new ThreadFactory() {
        @Override public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "Nore-Modrinth");
            t.setDaemon(true);
            return t;
        }
    });
    private static final Map<String, Object> ICONS = new ConcurrentHashMap<String, Object>();
    private static final Object NO_ICON = new Object();

    private Modrinth() {}

    public interface Callback<T> {
        void done(T result, Throwable error);
    }

    /** Folder the in-game browser installs to (resource packs only – mods come from the launcher). */
    public static File packDir() {
        return Platform.game().resourcePackDir();
    }

    public static final class Hit {
        public final String id, slug, title, author, description, iconUrl, galleryUrl;
        public final long downloads, follows;
        public final List<String> categories;

        Hit(String id, String slug, String title, String author, String description, long downloads, long follows, String iconUrl, String galleryUrl, List<String> categories) {
            this.id = id;
            this.slug = slug;
            this.title = title;
            this.author = author;
            this.description = description;
            this.downloads = downloads;
            this.follows = follows;
            this.iconUrl = iconUrl;
            this.galleryUrl = galleryUrl;
            this.categories = categories;
        }
    }

    /** One page of search results plus the total number of hits. */
    public static final class Page {
        public final List<Hit> hits;
        public final int total;

        Page(List<Hit> hits, int total) {
            this.hits = hits;
            this.total = total;
        }
    }

    public static String gameVersion() {
        return Platform.game().minecraftVersion();
    }

    static byte[] getBytes(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestProperty("User-Agent", UA);
        c.setConnectTimeout(10000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        int code = c.getResponseCode();
        if (code / 100 != 2) throw new IOException("HTTP " + code);
        InputStream in = c.getInputStream();
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }

    static String get(String url) throws IOException {
        return new String(getBytes(url), "UTF-8");
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (IOException e) {
            return s;
        }
    }

    private static JsonArray single(String v) {
        JsonArray a = new JsonArray();
        a.add(new JsonPrimitive(v));
        return a;
    }

    private static String str(JsonObject o, String k) {
        return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : "";
    }

    public static final int PAGE = 20;

    /** Searches resource packs for the running Minecraft version; category may be null. */
    public static void search(final String query, final String category, final String sort, final int offset, final Callback<Page> cb) {
        POOL.execute(new Runnable() {
            @Override public void run() {
                try {
                    JsonArray facets = new JsonArray();
                    facets.add(single("project_type:resourcepack"));
                    facets.add(single("versions:" + gameVersion()));
                    if (category != null && !category.isEmpty()) facets.add(single("categories:" + category));
                    String url = API + "/search?limit=" + PAGE + "&offset=" + offset + "&index=" + enc(sort) + "&query=" + enc(query) + "&facets=" + enc(facets.toString());
                    JsonObject root = new JsonParser().parse(get(url)).getAsJsonObject();
                    List<Hit> out = new ArrayList<Hit>();
                    for (JsonElement e : root.getAsJsonArray("hits")) {
                        JsonObject h = e.getAsJsonObject();
                        List<String> cats = new ArrayList<String>();
                        if (h.has("display_categories")) for (JsonElement c : h.getAsJsonArray("display_categories")) cats.add(c.getAsString());
                        out.add(new Hit(str(h, "project_id"), str(h, "slug"), str(h, "title"), str(h, "author"), str(h, "description"),
                                h.has("downloads") ? h.get("downloads").getAsLong() : 0, h.has("follows") ? h.get("follows").getAsLong() : 0,
                                str(h, "icon_url"), str(h, "featured_gallery"), cats));
                    }
                    cb.done(new Page(out, root.has("total_hits") ? root.get("total_hits").getAsInt() : out.size()), null);
                } catch (Throwable t) {
                    cb.done(null, t);
                }
            }
        });
    }

    /** Downloads the newest compatible version of a resource pack; returns the file name. */
    public static void install(final String projectId, final Callback<String> cb) {
        final File dir = packDir();
        POOL.execute(new Runnable() {
            @Override public void run() {
                try {
                    cb.done(download(projectId, dir), null);
                } catch (Throwable t) {
                    cb.done(null, t);
                }
            }
        });
    }

    private static String download(String projectId, File dir) throws Exception {
        String url = API + "/project/" + enc(projectId) + "/version?game_versions=" + enc("[\"" + gameVersion() + "\"]");
        JsonArray versions = new JsonParser().parse(get(url)).getAsJsonArray();
        if (versions.size() == 0) throw new IllegalStateException("Brak wersji dla " + gameVersion());
        JsonObject version = versions.get(0).getAsJsonObject();
        for (JsonElement v : versions) {
            if ("release".equals(str(v.getAsJsonObject(), "version_type"))) { version = v.getAsJsonObject(); break; }
        }
        JsonObject file = null;
        for (JsonElement f : version.getAsJsonArray("files")) {
            if (file == null || f.getAsJsonObject().get("primary").getAsBoolean()) file = f.getAsJsonObject();
        }
        if (file == null) throw new IllegalStateException("Brak pliku do pobrania");
        String name = new File(str(file, "filename")).getName();
        String sha1 = file.getAsJsonObject("hashes").has("sha1") ? file.getAsJsonObject("hashes").get("sha1").getAsString() : null;
        byte[] data = getBytes(str(file, "url"));
        if (sha1 != null && !sha1.equalsIgnoreCase(hex(MessageDigest.getInstance("SHA-1").digest(data)))) {
            throw new IllegalStateException("Błędna suma kontrolna");
        }
        dir.mkdirs();
        File tmp = new File(dir, name + ".part");
        OutputStream out = new FileOutputStream(tmp);
        try { out.write(data); } finally { out.close(); }
        File dest = new File(dir, name);
        if (dest.exists()) dest.delete();
        if (!tmp.renameTo(dest)) throw new IOException("Nie można zapisać " + name);
        return name;
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x & 0xFF));
        return sb.toString();
    }

    /** Icon texture, loaded in the background; null while loading or if not a PNG. */
    private static final int ICON_SIZE = 64;

    /**
     * Downloads an icon as a small PNG. Minecraft can only load PNG, while Modrinth icons are
     * often WebP, JPEG or GIF: JPEG/GIF/PNG are decoded and scaled with ImageIO, WebP (which Java
     * cannot decode) is fetched as PNG through the wsrv.nl image proxy.
     */
    static byte[] iconPng(String url) {
        try {
            byte[] raw = getBytes(url);
            boolean webp = raw.length > 12 && raw[0] == 'R' && raw[1] == 'I' && raw[2] == 'F' && raw[3] == 'F'
                    && raw[8] == 'W' && raw[9] == 'E' && raw[10] == 'B' && raw[11] == 'P';
            if (!webp) {
                byte[] png = toSmallPng(raw);
                if (png != null) return png;
            }
        } catch (Throwable ignored) {
            // fall through to the proxy
        }
        try {
            return toSmallPng(getBytes("https://wsrv.nl/?url=" + enc(url) + "&output=png&w=" + ICON_SIZE + "&h=" + ICON_SIZE + "&fit=contain"));
        } catch (Throwable t) {
            return null;
        }
    }

    private static byte[] toSmallPng(byte[] data) throws IOException {
        System.setProperty("java.awt.headless", "true");
        java.awt.image.BufferedImage src = javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(data));
        if (src == null) return null;
        int w = src.getWidth(), h = src.getHeight();
        float scale = Math.min(1f, ICON_SIZE / (float) Math.max(w, h));
        int tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
        java.awt.image.BufferedImage out = new java.awt.image.BufferedImage(tw, th, java.awt.image.BufferedImage.TYPE_INT_ARGB);
        java.awt.Graphics2D g = out.createGraphics();
        g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setRenderingHint(java.awt.RenderingHints.KEY_RENDERING, java.awt.RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(src, 0, 0, tw, th, null);
        g.dispose();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        javax.imageio.ImageIO.write(out, "png", bytes);
        return bytes.toByteArray();
    }

    public static TextureRef icon(final String url) {
        if (url == null || url.isEmpty()) return null;
        Object o = ICONS.get(url);
        if (o == NO_ICON) return null;
        if (o instanceof TextureRef) return (TextureRef) o;
        if (o == null) {
            ICONS.put(url, "loading");
            POOL.execute(new Runnable() {
                @Override public void run() {
                    try {
                        final byte[] data = iconPng(url);
                        if (data == null) { ICONS.put(url, NO_ICON); return; }
                        NoreClient.runNextTick(new Runnable() {
                            @Override public void run() {
                                TextureRef t = Platform.game().loadTexture("modrinth/" + Integer.toHexString(url.hashCode()), data);
                                ICONS.put(url, t == null ? NO_ICON : t);
                            }
                        });
                    } catch (Throwable t) {
                        ICONS.put(url, NO_ICON);
                    }
                }
            });
        }
        return null;
    }
}
