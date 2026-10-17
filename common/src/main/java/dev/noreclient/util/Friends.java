package dev.noreclient.util;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import dev.noreclient.api.Platform;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * Friends list (nicks) in config/noreclient/friends.json. Nore Launcher writes the same file, so
 * friends added in the launcher show up in every instance.
 */
public final class Friends {
    private static final Set<String> NAMES = new CopyOnWriteArraySet<String>();
    private static final List<String> ORDER = new ArrayList<String>();
    private static long loadedMtime = -1;

    private Friends() {}

    private static File file() {
        return new File(Platform.game().gameDir(), "config/noreclient/friends.json");
    }

    /** Reloads when the file changed (e.g. the launcher wrote it). */
    public static synchronized void refresh() {
        File f = file();
        long m = f.exists() ? f.lastModified() : 0;
        if (m == loadedMtime) return;
        loadedMtime = m;
        NAMES.clear();
        ORDER.clear();
        if (!f.exists()) return;
        try {
            JsonElement root = Json.parse(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
            JsonArray arr = root.isJsonArray() ? root.getAsJsonArray() : root.getAsJsonObject().getAsJsonArray("friends");
            for (JsonElement e : arr) {
                String n = e.isJsonPrimitive() ? e.getAsString() : e.getAsJsonObject().get("name").getAsString();
                if (NAMES.add(n.toLowerCase(Locale.ROOT))) ORDER.add(n);
            }
        } catch (Exception ignored) {
            // unreadable file: start empty
        }
    }

    private static synchronized void save() {
        File f = file();
        f.getParentFile().mkdirs();
        JsonArray arr = new JsonArray();
        for (String n : ORDER) arr.add(n);
        try {
            Files.write(f.toPath(), arr.toString().getBytes(StandardCharsets.UTF_8));
            loadedMtime = f.lastModified();
        } catch (Exception ignored) {
            // read-only folder
        }
    }

    public static boolean isFriend(String name) {
        return name != null && NAMES.contains(name.toLowerCase(Locale.ROOT));
    }

    public static synchronized List<String> list() {
        refresh();
        return new ArrayList<String>(ORDER);
    }

    public static synchronized boolean add(String name) {
        refresh();
        if (name == null || !name.matches("[A-Za-z0-9_]{2,16}") || isFriend(name)) return false;
        NAMES.add(name.toLowerCase(Locale.ROOT));
        ORDER.add(name);
        save();
        return true;
    }

    public static synchronized void remove(String name) {
        refresh();
        NAMES.remove(name.toLowerCase(Locale.ROOT));
        ORDER.removeIf(n -> n.equalsIgnoreCase(name));
        save();
    }
}
