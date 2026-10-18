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
    /** Players whose chat messages are hidden (config/noreclient/muted.json). */
    private static final Set<String> MUTED = new CopyOnWriteArraySet<String>();
    private static volatile boolean mutedLoaded;
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

    // ------------------------------------------------------------------ muted players

    private static File mutedFile() {
        return new File(Platform.game().gameDir(), "config/noreclient/muted.json");
    }

    private static synchronized void loadMuted() {
        if (mutedLoaded) return;
        mutedLoaded = true;
        File f = mutedFile();
        if (!f.exists()) return;
        try {
            JsonElement root = Json.parse(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
            if (root.isJsonArray()) for (JsonElement e : root.getAsJsonArray()) MUTED.add(e.getAsString().toLowerCase(Locale.ROOT));
        } catch (Exception ignored) {
            // unreadable file: nobody muted
        }
    }

    /** True when this player's chat messages are hidden. Cheap: called for every chat line. */
    public static boolean isMuted(String name) {
        if (!mutedLoaded) loadMuted();
        return name != null && !MUTED.isEmpty() && MUTED.contains(name.toLowerCase(Locale.ROOT));
    }

    public static boolean anyMuted() {
        if (!mutedLoaded) loadMuted();
        return !MUTED.isEmpty();
    }

    public static synchronized void setMuted(String name, boolean muted) {
        loadMuted();
        if (name == null || name.isEmpty()) return;
        if (muted) MUTED.add(name.toLowerCase(Locale.ROOT));
        else MUTED.remove(name.toLowerCase(Locale.ROOT));
        File f = mutedFile();
        f.getParentFile().mkdirs();
        JsonArray arr = new JsonArray();
        for (String n : MUTED) arr.add(n);
        try {
            Files.write(f.toPath(), arr.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            // read-only folder: muted for this session only
        }
    }

    private static final java.util.regex.Pattern TIMESTAMP = java.util.regex.Pattern.compile("^\\[\\d{1,2}:\\d{2}(:\\d{2})?\\]\\s*");
    private static final java.util.regex.Pattern NAME = java.util.regex.Pattern.compile("[A-Za-z0-9_]{2,16}");

    /**
     * Sender of a chat line as servers usually format it: "&lt;Nick&gt; text", "[Rank] Nick: text",
     * "Nick » text", "Nick whispers to you: text" (colour codes and a timestamp prefix are skipped).
     * Null when the line does not look like a player message.
     */
    public static String chatSender(String line) {
        if (line == null) return null;
        StringBuilder b = new StringBuilder(Math.min(line.length(), 96));
        for (int i = 0; i < line.length() && b.length() < 96; i++) {
            char c = line.charAt(i);
            if (c == '§') { i++; continue; }
            b.append(c);
        }
        String s = TIMESTAMP.matcher(b.toString().trim()).replaceFirst("");
        int lt = s.indexOf('<'), gt = s.indexOf('>');
        if (lt >= 0 && lt < 24 && gt > lt + 1) {
            String n = lastWord(s.substring(lt + 1, gt));
            if (n != null) return n;
        }
        int cut = -1;
        for (String sep : new String[]{":", "»", ">", "›", "|"}) {
            int i = s.indexOf(sep);
            if (i > 0 && (cut < 0 || i < cut)) cut = i;
        }
        if (cut <= 0 || cut > 64) return null;
        String head = s.substring(0, cut).trim();
        String[] words = head.split("\\s+");
        if (words.length >= 3 && head.toLowerCase(Locale.ROOT).contains("whispers")) return clean(words[0]);
        return lastWord(head);
    }

    private static String lastWord(String head) {
        String[] words = head.trim().split("\\s+");
        for (int i = words.length - 1; i >= 0; i--) {
            String w = clean(words[i]);
            if (w != null) return w;
        }
        return null;
    }

    private static String clean(String w) {
        int a = 0, z = w.length();
        while (a < z && !isNameChar(w.charAt(a))) a++;
        while (z > a && !isNameChar(w.charAt(z - 1))) z--;
        w = w.substring(a, z);
        return NAME.matcher(w).matches() ? w : null;
    }

    private static boolean isNameChar(char c) {
        return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_';
    }
}
