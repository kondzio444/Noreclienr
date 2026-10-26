package dev.noreclient.util;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Nore Hub client (docs/nore-hub.md): which players around us also play with Nore, and what they
 * wear. Lookups run on a background thread; every getter is a cheap cache read that never blocks,
 * so renderers may call it every frame.
 *
 * <p>Network rules: nothing at all outside a multiplayer world (only the local player in
 * singleplayer); names are looked up in batches of up to 100, each result (also "not a Nore
 * user") is kept for 60 s and re-checked while the name is still visible; errors back off
 * exponentially up to 5 minutes.
 */
public final class NoreHub {
    /** One Nore user as the hub reported them. */
    public static final class Entry {
        public final String name, uuid, hex;
        public final boolean verified, online;
        public final long seen;
        /** The wardrobe they wear ({"v":1,"slots":{…}}), never null. */
        public final JsonObject cosmetics;

        public Entry(String name, String uuid, String hex, boolean verified, boolean online, long seen, JsonObject cosmetics) {
            this.name = name; this.uuid = uuid; this.hex = hex; this.verified = verified; this.online = online; this.seen = seen;
            this.cosmetics = cosmetics == null ? new JsonObject() : cosmetics;
        }
    }

    /** Where lookups may happen: nowhere, only the local player, every observed name. */
    public static final int SCOPE_NONE = 0, SCOPE_LOCAL = 1, SCOPE_ALL = 2;

    private static final String BASE = trimSlash(System.getProperty("noreclient.hub", "https://noreclient.pl"));
    private static final long TTL = 60_000L, VISIBLE = 15_000L, FORGET = 10 * 60_000L, EXPLICIT = 2 * 60_000L;
    private static final int BATCH = 100;

    private static final class Slot {
        final String name;
        volatile Entry entry;
        /** Last lookup (0 = never), last time the name was seen / asked for, explicit request time. */
        volatile long fetched, seen, explicit;

        Slot(String name) { this.name = name; }
    }

    private static final Map<String, Slot> SLOTS = new ConcurrentHashMap<String, Slot>();
    private static final Object LOCK = new Object();
    private static volatile int scope = SCOPE_NONE;
    private static volatile String local = "";
    private static volatile String pendingPublish, lastPublished;
    private static volatile long pendingSince, publishRetryAt;
    private static Thread thread;
    private static long backoffUntil, backoffMs;

    private NoreHub() {}

    private static String trimSlash(String s) {
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    /** Minecraft name rules (2–16 of A-Z a-z 0-9 _), without a regex: called every frame. */
    static boolean validName(String n) {
        if (n == null || n.length() < 2 || n.length() > 16) return false;
        for (int i = 0; i < n.length(); i++) {
            char c = n.charAt(i);
            if (!(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_')) return false;
        }
        return true;
    }

    private static Slot slot(String name, boolean create) {
        if (!validName(name)) return null;
        String key = name.toLowerCase(Locale.ROOT);
        Slot s = SLOTS.get(key);
        if (s == null && create) {
            s = new Slot(name);
            Slot prev = SLOTS.putIfAbsent(key, s);
            if (prev != null) s = prev;
        }
        return s;
    }

    /**
     * Sets what may be looked up (game thread, every couple of seconds): {@link #SCOPE_ALL} in a
     * multiplayer world, {@link #SCOPE_LOCAL} in singleplayer, {@link #SCOPE_NONE} in menus.
     */
    public static void scope(int newScope, String localName) {
        scope = newScope;
        local = localName == null ? "" : localName.toLowerCase(Locale.ROOT);
        if (newScope != SCOPE_NONE) ensureThread();
    }

    /** Names currently around the player (tab list, nearby players); unknown ones are looked up in batches. */
    public static void observe(Collection<String> names) {
        long now = System.currentTimeMillis();
        boolean fresh = false;
        for (String n : names) {
            Slot s = slot(n, true);
            if (s == null) continue;
            s.seen = now;
            if (s.fetched == 0) fresh = true;
        }
        if (fresh) wake();
    }

    /**
     * A lookup the player asked for (adding a friend by nick, opening a profile): done once even
     * outside a multiplayer world.
     */
    public static void request(String name) {
        Slot s = slot(name, true);
        if (s == null) return;
        long now = System.currentTimeMillis();
        s.seen = now;
        if (now - s.fetched > 30_000L) {
            s.explicit = now;
            s.fetched = Math.min(s.fetched, now - TTL);
            ensureThread();
            wake();
        }
    }

    /** Cached entry for a name (case-insensitive), or null when not a Nore user / not looked up yet. */
    public static Entry get(String name) {
        Slot s = slot(name, true);
        if (s == null) return null;
        s.seen = System.currentTimeMillis();
        return s.entry;
    }

    public static boolean isNore(String name) { return get(name) != null; }

    /** True once the hub answered for this name (Nore user or not). */
    public static boolean known(String name) {
        Slot s = slot(name, false);
        return s != null && s.fetched > 0 && s.explicit == 0;
    }

    /** Publishes the local player's wardrobe through the launcher bridge (no-op without the launcher). */
    public static void publish(JsonObject cosmetics) {
        if (cosmetics == null || !LauncherChat.available()) return;
        String json = cosmetics.toString();
        if (json.equals(lastPublished) && pendingPublish == null) return;
        pendingPublish = json;
        pendingSince = System.currentTimeMillis();
        publishRetryAt = 0;
        ensureThread();
        wake();
    }

    // ------------------------------------------------------------------ background thread

    private static void wake() {
        synchronized (LOCK) { LOCK.notifyAll(); }
    }

    private static synchronized void ensureThread() {
        if (thread != null) return;
        thread = new Thread(NoreHub::loop, "Nore Hub");
        thread.setDaemon(true);
        thread.start();
    }

    private static void loop() {
        while (true) {
            try {
                synchronized (LOCK) { LOCK.wait(1000); }
            } catch (InterruptedException e) {
                return;
            }
            try {
                publishStep();
                lookupStep();
            } catch (Throwable ignored) {
                // never let the thread die
            }
        }
    }

    private static void publishStep() {
        String json = pendingPublish;
        long now = System.currentTimeMillis();
        // coalesce quick wardrobe edits; the launcher sends a hello within 2 s of a change
        if (json == null || now - pendingSince < 700 || now < publishRetryAt) return;
        try {
            JsonObject body = new JsonObject();
            body.add("cosmetics", Json.parse(json));
            LauncherChat.postNow("/v1/presence", body);
            if (json.equals(pendingPublish)) pendingPublish = null;
            lastPublished = json;
            // our own entry changes on the hub a moment later: look again soon
            Slot me = local.isEmpty() ? null : SLOTS.get(local);
            if (me != null) me.fetched = Math.min(me.fetched, now - TTL + 5_000L);
        } catch (LauncherChat.BridgeException e) {
            if (e.code == 404 || e.code == 400) pendingPublish = null; // older launcher / rejected: give up on this one
            else publishRetryAt = now + 10_000L;
        } catch (Exception e) {
            publishRetryAt = now + 10_000L;
        }
    }

    private static void lookupStep() throws Exception {
        long now = System.currentTimeMillis();
        int sc = scope;
        String me = local;
        List<Slot> due = new ArrayList<Slot>();
        for (Iterator<Map.Entry<String, Slot>> it = SLOTS.entrySet().iterator(); it.hasNext(); ) {
            Map.Entry<String, Slot> e = it.next();
            Slot s = e.getValue();
            boolean explicit = s.explicit > 0 && now - s.explicit < EXPLICIT;
            if (!explicit && s.explicit > 0) s.explicit = 0;
            if (now - s.seen > FORGET && !explicit) { it.remove(); continue; }
            if (!explicit) {
                if (sc == SCOPE_NONE) continue;
                if (sc == SCOPE_LOCAL && !e.getKey().equals(me)) continue;
                if (now - s.seen > VISIBLE) continue;
            }
            if (now - s.fetched < TTL) continue;
            if (due.size() < BATCH) due.add(s);
        }
        if (due.isEmpty() || now < backoffUntil) return;
        try {
            Map<String, Entry> found = fetch(due);
            long t = System.currentTimeMillis();
            for (Slot s : due) {
                s.entry = found.get(s.name.toLowerCase(Locale.ROOT));
                s.fetched = t;
                s.explicit = 0;
            }
            backoffMs = 0;
        } catch (Exception e) {
            backoffMs = backoffMs == 0 ? 5_000L : Math.min(backoffMs * 2, 300_000L);
            backoffUntil = System.currentTimeMillis() + backoffMs;
        }
    }

    private static Map<String, Entry> fetch(List<Slot> due) throws Exception {
        StringBuilder q = new StringBuilder();
        for (Slot s : due) {
            if (q.length() > 0) q.append(',');
            q.append(s.name);
        }
        HttpURLConnection c = (HttpURLConnection) new URL(BASE + "/api/v1/hub/players?names=" + URLEncoder.encode(q.toString(), "UTF-8")).openConnection();
        c.setConnectTimeout(5000);
        c.setReadTimeout(8000);
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("User-Agent", "NoreClient");
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new IllegalStateException("HTTP " + code);
            String body;
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] b = new byte[8192];
                for (int n; (n = in.read(b)) > 0; ) buf.write(b, 0, n);
                body = new String(buf.toByteArray(), StandardCharsets.UTF_8);
            }
            Map<String, Entry> out = new ConcurrentHashMap<String, Entry>();
            JsonObject root = Json.parse(body).getAsJsonObject();
            if (!root.has("players") || !root.get("players").isJsonObject()) return out;
            for (Map.Entry<String, JsonElement> e : root.getAsJsonObject("players").entrySet()) {
                if (!e.getValue().isJsonObject()) continue;
                JsonObject o = e.getValue().getAsJsonObject();
                String name = str(o, "name");
                if (name.isEmpty()) name = e.getKey();
                JsonObject cos = o.has("cosmetics") && o.get("cosmetics").isJsonObject() ? o.getAsJsonObject("cosmetics") : null;
                out.put(e.getKey().toLowerCase(Locale.ROOT), new Entry(name, str(o, "uuid"), str(o, "hex"), bool(o, "verified"), bool(o, "online"),
                        o.has("seen") && o.get("seen").isJsonPrimitive() ? o.get("seen").getAsLong() : 0L, cos));
            }
            return out;
        } finally {
            c.disconnect();
        }
    }

    private static String str(JsonObject o, String k) {
        return o.has(k) && o.get(k).isJsonPrimitive() ? o.get(k).getAsString() : "";
    }

    private static boolean bool(JsonObject o, String k) {
        return o.has(k) && o.get(k).isJsonPrimitive() && o.get(k).getAsBoolean();
    }
}
