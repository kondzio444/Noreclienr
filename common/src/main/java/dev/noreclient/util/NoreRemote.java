package dev.noreclient.util;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * What the Nore team sets for the mod (docs/admin-api.md): announcements shown on top of the main
 * menu news, the maintenance note and the module kill-switch, from
 * GET /api/v2/client/config?target=mod (same host as Nore Hub). Read once on a background thread
 * shortly after the first use, then every 10 minutes; every getter is a cheap read that never blocks.
 * Without network nothing changes: no announcements, nothing switched off.
 */
public final class NoreRemote {
    /** One announcement: level is info, warning or event. */
    public static final class Notice {
        public final String id, title, body, level;

        Notice(String id, String title, String body, String level) {
            this.id = id; this.title = title; this.body = body; this.level = level;
        }
    }

    private static final String BASE = trim(System.getProperty("noreclient.hub", "https://noreclient.pl"));
    private static final long EVERY = 10 * 60_000L, RETRY = 60_000L;

    private static volatile List<Notice> notices = Collections.emptyList();
    private static volatile Set<String> killed = Collections.emptySet();
    private static volatile String maintenance = null;
    private static volatile boolean started;

    private NoreRemote() {}

    private static String trim(String s) {
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    /** Active announcements for the mod (newest first), never null. */
    public static List<Notice> notices() {
        ensure();
        return notices;
    }

    /** The maintenance message, or null when there is no maintenance. */
    public static String maintenance() {
        ensure();
        return maintenance;
    }

    /** True when the Nore team switched this module off (name compared case-insensitively). */
    public static boolean killed(String moduleName) {
        ensure();
        Set<String> k = killed;
        return !k.isEmpty() && moduleName != null && k.contains(moduleName.toLowerCase(Locale.ROOT));
    }

    private static synchronized void ensure() {
        if (started) return;
        started = true;
        Thread t = new Thread(NoreRemote::loop, "Nore Remote");
        t.setDaemon(true);
        t.start();
    }

    private static void loop() {
        long wait = 3_000L;
        while (true) {
            try {
                Thread.sleep(wait);
            } catch (InterruptedException e) {
                return;
            }
            try {
                load();
                wait = EVERY;
            } catch (Throwable e) {
                wait = RETRY; // offline: keep the last copy, try again sooner
            }
        }
    }

    private static void load() throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(BASE + "/api/v2/client/config?target=mod").openConnection();
        c.setConnectTimeout(5000);
        c.setReadTimeout(8000);
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("User-Agent", "NoreClient");
        try {
            if (c.getResponseCode() != 200) throw new IllegalStateException("HTTP " + c.getResponseCode());
            String body;
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] b = new byte[8192];
                for (int n; (n = in.read(b)) > 0; ) {
                    buf.write(b, 0, n);
                    if (buf.size() > 256 * 1024) throw new IllegalStateException("too large");
                }
                body = new String(buf.toByteArray(), StandardCharsets.UTF_8);
            }
            apply(Json.parse(body).getAsJsonObject());
        } finally {
            c.disconnect();
        }
    }

    /** Reads a client config answer (package-private for tests). */
    static void apply(JsonObject root) {
        List<Notice> list = new ArrayList<Notice>();
        if (root.has("announcements") && root.get("announcements").isJsonArray()) {
            JsonArray arr = root.getAsJsonArray("announcements");
            for (int i = 0; i < arr.size() && list.size() < 5; i++) {
                JsonElement e = arr.get(i);
                if (!e.isJsonObject()) continue;
                JsonObject o = e.getAsJsonObject();
                String title = str(o, "title");
                if (title.isEmpty()) continue;
                list.add(new Notice(str(o, "id"), cut(title, 120), cut(str(o, "body"), 600), str(o, "level")));
            }
        }
        Set<String> off = new HashSet<String>();
        if (root.has("killSwitch") && root.get("killSwitch").isJsonObject()) {
            JsonObject k = root.getAsJsonObject("killSwitch");
            if (k.has("modules") && k.get("modules").isJsonArray()) {
                for (JsonElement e : k.getAsJsonArray("modules")) {
                    if (e.isJsonPrimitive()) off.add(e.getAsString().toLowerCase(Locale.ROOT));
                }
            }
        }
        String m = null;
        if (root.has("maintenance") && root.get("maintenance").isJsonObject()) {
            JsonObject o = root.getAsJsonObject("maintenance");
            if (o.has("enabled") && o.get("enabled").isJsonPrimitive() && o.get("enabled").getAsBoolean()) {
                m = str(o, "message");
                if (m.isEmpty()) m = "Przerwa techniczna";
            }
        }
        notices = Collections.unmodifiableList(list);
        killed = Collections.unmodifiableSet(off);
        maintenance = m;
    }

    private static String cut(String s, int max) {
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static String str(JsonObject o, String k) {
        return o.has(k) && o.get(k).isJsonPrimitive() ? o.get(k).getAsString() : "";
    }
}
