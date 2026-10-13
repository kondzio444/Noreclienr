package dev.noreclient.util;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.noreclient.NoreClient;
import net.minecraft.SharedConstants;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.util.Identifier;
import net.minecraft.util.WorldSavePath;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/** Tiny async Modrinth API client used by the in-game content browser. */
public final class Modrinth {
    private static final String API = "https://api.modrinth.com/v2";
    private static final String UA = "NoreClient/" + NoreClient.VERSION + " (github.com/kondzio444/Noreclienr)";
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build();
    private static final Map<String, Identifier> ICONS = new ConcurrentHashMap<>();
    private static final Set<String> ICON_LOADING = ConcurrentHashMap.newKeySet();
    private static final Identifier NO_ICON = Identifier.of("noreclient", "none");

    private Modrinth() {}

    /** What can be downloaded and where it goes. */
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

        /** Target directory, or null when not available right now (datapacks need an open world). */
        public Path targetDir() {
            MinecraftClient mc = MinecraftClient.getInstance();
            Path run = mc.runDirectory.toPath();
            return switch (this) {
                case RESOURCEPACK -> mc.getResourcePackDir();
                case MOD -> run.resolve("mods");
                case SHADER -> run.resolve("shaderpacks");
                case DATAPACK -> mc.getServer() != null ? mc.getServer().getSavePath(WorldSavePath.DATAPACKS) : null;
            };
        }
    }

    public record Hit(String id, String slug, String title, String author, String description,
                      long downloads, String iconUrl) {}

    public static String gameVersion() {
        return SharedConstants.getGameVersion().getName();
    }

    private static CompletableFuture<String> get(String url) {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url)).header("User-Agent", UA).timeout(Duration.ofSeconds(20)).GET().build();
        return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString()).thenApply(r -> {
            if (r.statusCode() / 100 != 2) throw new IllegalStateException("HTTP " + r.statusCode());
            return r.body();
        });
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    public static CompletableFuture<List<Hit>> search(String query, Kind kind, String sort, int offset) {
        JsonArray facets = new JsonArray();
        facets.add(single("project_type:" + kind.projectType));
        facets.add(single("versions:" + gameVersion()));
        if (kind == Kind.MOD) facets.add(single("categories:fabric"));
        String url = API + "/search?limit=20&offset=" + offset + "&index=" + enc(sort) + "&query=" + enc(query) + "&facets=" + enc(facets.toString());
        return get(url).thenApply(body -> {
            List<Hit> out = new ArrayList<>();
            for (JsonElement e : JsonParser.parseString(body).getAsJsonObject().getAsJsonArray("hits")) {
                JsonObject h = e.getAsJsonObject();
                out.add(new Hit(str(h, "project_id"), str(h, "slug"), str(h, "title"), str(h, "author"),
                        str(h, "description"), h.has("downloads") ? h.get("downloads").getAsLong() : 0, str(h, "icon_url")));
            }
            return out;
        });
    }

    private static JsonArray single(String v) {
        JsonArray a = new JsonArray();
        a.add(v);
        return a;
    }

    private static String str(JsonObject o, String k) {
        return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : "";
    }

    /** Downloads the newest compatible version (plus required dependencies for mods). Returns the main file name. */
    public static CompletableFuture<String> install(String projectId, Kind kind) {
        Path dir = kind.targetDir();
        if (dir == null) return CompletableFuture.failedFuture(new IllegalStateException("Otwórz świat w trybie jednoosobowym"));
        return installRec(projectId, kind, dir, new HashSet<>());
    }

    private static CompletableFuture<String> installRec(String projectId, Kind kind, Path dir, Set<String> seen) {
        if (!seen.add(projectId)) return CompletableFuture.completedFuture(null);
        StringBuilder url = new StringBuilder(API + "/project/" + enc(projectId) + "/version?game_versions=" + enc("[\"" + gameVersion() + "\"]"));
        if (kind == Kind.MOD) url.append("&loaders=").append(enc("[\"fabric\"]"));
        if (kind == Kind.DATAPACK) url.append("&loaders=").append(enc("[\"datapack\"]"));
        return get(url.toString()).thenCompose(body -> {
            JsonArray versions = JsonParser.parseString(body).getAsJsonArray();
            if (versions.isEmpty()) throw new IllegalStateException("Brak wersji dla " + gameVersion());
            JsonObject version = versions.get(0).getAsJsonObject();
            for (JsonElement v : versions) {
                if ("release".equals(str(v.getAsJsonObject(), "version_type"))) { version = v.getAsJsonObject(); break; }
            }
            JsonObject file = null;
            for (JsonElement f : version.getAsJsonArray("files")) {
                if (file == null || f.getAsJsonObject().get("primary").getAsBoolean()) file = f.getAsJsonObject();
            }
            if (file == null) throw new IllegalStateException("Brak pliku do pobrania");
            String name = Path.of(str(file, "filename")).getFileName().toString();
            String sha1 = file.getAsJsonObject("hashes").has("sha1") ? file.getAsJsonObject("hashes").get("sha1").getAsString() : null;
            CompletableFuture<String> main = download(str(file, "url"), dir.resolve(name), sha1).thenApply(p -> name);
            if (kind != Kind.MOD) return main;
            List<CompletableFuture<String>> deps = new ArrayList<>();
            for (JsonElement d : version.getAsJsonArray("dependencies")) {
                JsonObject dep = d.getAsJsonObject();
                if ("required".equals(str(dep, "dependency_type")) && !str(dep, "project_id").isEmpty()) {
                    deps.add(installRec(str(dep, "project_id"), kind, dir, seen).exceptionally(t -> null));
                }
            }
            return main.thenCombine(CompletableFuture.allOf(deps.toArray(CompletableFuture[]::new)), (a, b) -> a);
        });
    }

    private static CompletableFuture<Path> download(String url, Path dest, String sha1) {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url)).header("User-Agent", UA).GET().build();
        return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofByteArray()).thenApply(r -> {
            if (r.statusCode() / 100 != 2) throw new IllegalStateException("HTTP " + r.statusCode());
            byte[] data = r.body();
            try {
                if (sha1 != null) {
                    String got = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(data));
                    if (!got.equalsIgnoreCase(sha1)) throw new IllegalStateException("Błędna suma kontrolna");
                }
                Files.createDirectories(dest.getParent());
                Path tmp = dest.resolveSibling(dest.getFileName() + ".part");
                Files.write(tmp, data);
                Files.move(tmp, dest, StandardCopyOption.REPLACE_EXISTING);
                return dest;
            } catch (IOException | java.security.NoSuchAlgorithmException e) {
                throw new IllegalStateException(e.getMessage(), e);
            }
        });
    }

    /** Enables a downloaded resource pack and reloads resources. */
    public static void enableResourcePack(String fileName) {
        MinecraftClient mc = MinecraftClient.getInstance();
        var manager = mc.getResourcePackManager();
        manager.scanPacks();
        if (manager.enable("file/" + fileName)) mc.options.refreshResourcePacks(manager);
    }

    /**
     * Returns the texture for a project icon, loading it in the background. Returns null while
     * loading or when the icon can't be decoded (e.g. WebP).
     */
    public static Identifier icon(String url) {
        if (url == null || url.isEmpty()) return null;
        Identifier id = ICONS.get(url);
        if (id != null) return id == NO_ICON ? null : id;
        if (ICON_LOADING.add(url)) {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url)).header("User-Agent", UA).GET().build();
            HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofByteArray()).whenComplete((r, t) -> {
                byte[] data = t == null && r.statusCode() == 200 ? r.body() : null;
                boolean png = data != null && data.length > 8 && (data[0] & 0xFF) == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G';
                if (!png) {
                    ICONS.put(url, NO_ICON);
                    return;
                }
                MinecraftClient.getInstance().execute(() -> {
                    try {
                        NativeImage img = NativeImage.read(new ByteArrayInputStream(data));
                        Identifier tex = Identifier.of("noreclient", "modrinth/" + Integer.toHexString(url.hashCode()));
                        MinecraftClient.getInstance().getTextureManager().registerTexture(tex, new NativeImageBackedTexture(img));
                        ICONS.put(url, tex);
                    } catch (Exception e) {
                        ICONS.put(url, NO_ICON);
                    }
                });
            });
        }
        return null;
    }
}
