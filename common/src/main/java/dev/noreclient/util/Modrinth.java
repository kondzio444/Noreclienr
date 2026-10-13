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
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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

    public enum Kind {
        RESOURCEPACK("resourcepack", "Paczki zasobów"),
        MOD("mod", "Mody"),
        DATAPACK("datapack", "Datapacki"),
        SHADER("shader", "Shadery");

        public final String projectType;
        public final String label;

        Kind(String projectType, String label) {
            this.projectType = projectType;
            this.label = label;
        }

        public File targetDir() {
            File run = Platform.game().gameDir();
            switch (this) {
                case RESOURCEPACK: return Platform.game().resourcePackDir();
                case MOD: return new File(run, "mods");
                case SHADER: return new File(run, "shaderpacks");
                default: return Platform.game().datapackDir();
            }
        }
    }

    public static final class Hit {
        public final String id, slug, title, author, description, iconUrl;
        public final long downloads;

        Hit(String id, String slug, String title, String author, String description, long downloads, String iconUrl) {
            this.id = id;
            this.slug = slug;
            this.title = title;
            this.author = author;
            this.description = description;
            this.downloads = downloads;
            this.iconUrl = iconUrl;
        }
    }

    public static String gameVersion() {
        return Platform.game().minecraftVersion();
    }

    private static byte[] getBytes(String url) throws IOException {
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

    private static String get(String url) throws IOException {
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

    public static void search(final String query, final Kind kind, final String sort, final int offset, final Callback<List<Hit>> cb) {
        POOL.execute(new Runnable() {
            @Override public void run() {
                try {
                    JsonArray facets = new JsonArray();
                    facets.add(single("project_type:" + kind.projectType));
                    facets.add(single("versions:" + gameVersion()));
                    if (kind == Kind.MOD) facets.add(single("categories:fabric"));
                    String url = API + "/search?limit=20&offset=" + offset + "&index=" + enc(sort) + "&query=" + enc(query) + "&facets=" + enc(facets.toString());
                    JsonObject root = new JsonParser().parse(get(url)).getAsJsonObject();
                    List<Hit> out = new ArrayList<Hit>();
                    for (JsonElement e : root.getAsJsonArray("hits")) {
                        JsonObject h = e.getAsJsonObject();
                        out.add(new Hit(str(h, "project_id"), str(h, "slug"), str(h, "title"), str(h, "author"),
                                str(h, "description"), h.has("downloads") ? h.get("downloads").getAsLong() : 0, str(h, "icon_url")));
                    }
                    cb.done(out, null);
                } catch (Throwable t) {
                    cb.done(null, t);
                }
            }
        });
    }

    public static void install(final String projectId, final Kind kind, final Callback<String> cb) {
        final File dir = kind.targetDir();
        if (dir == null) {
            cb.done(null, new IllegalStateException("Otwórz świat w trybie jednoosobowym"));
            return;
        }
        POOL.execute(new Runnable() {
            @Override public void run() {
                try {
                    cb.done(installRec(projectId, kind, dir, new HashSet<String>()), null);
                } catch (Throwable t) {
                    cb.done(null, t);
                }
            }
        });
    }

    private static String installRec(String projectId, Kind kind, File dir, Set<String> seen) throws Exception {
        if (!seen.add(projectId)) return null;
        String url = API + "/project/" + enc(projectId) + "/version?game_versions=" + enc("[\"" + gameVersion() + "\"]");
        if (kind == Kind.MOD) url += "&loaders=" + enc("[\"fabric\"]");
        if (kind == Kind.DATAPACK) url += "&loaders=" + enc("[\"datapack\"]");
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
        if (kind == Kind.MOD) {
            for (JsonElement d : version.getAsJsonArray("dependencies")) {
                JsonObject dep = d.getAsJsonObject();
                if ("required".equals(str(dep, "dependency_type")) && !str(dep, "project_id").isEmpty()) {
                    try { installRec(str(dep, "project_id"), kind, dir, seen); } catch (Exception ignored) { }
                }
            }
        }
        return name;
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x & 0xFF));
        return sb.toString();
    }

    /** Icon texture, loaded in the background; null while loading or if not a PNG. */
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
                        final byte[] data = getBytes(url);
                        boolean png = data.length > 8 && (data[0] & 0xFF) == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G';
                        if (!png) { ICONS.put(url, NO_ICON); return; }
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
