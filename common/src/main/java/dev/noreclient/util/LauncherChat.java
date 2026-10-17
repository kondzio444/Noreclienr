package dev.noreclient.util;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.function.Consumer;

/**
 * The launcher's friends chat inside the game. Nore Launcher starts the game with
 * -Dnoreclient.chatBridge=&lt;port&gt;:&lt;token&gt; and serves friends, history and new messages on
 * 127.0.0.1; this class long-polls it on a daemon thread and sends messages back. Without the
 * launcher (or with an older one) everything stays quietly unavailable.
 */
public final class LauncherChat {
    public static final class Contact {
        public final String hex, name, status, detail;
        public final boolean online;
        public final int unread;
        public final String last;

        Contact(JsonObject o) {
            hex = str(o, "hex"); name = str(o, "name"); status = str(o, "status"); detail = str(o, "detail");
            online = o.has("online") && o.get("online").getAsBoolean();
            unread = o.has("unread") ? o.get("unread").getAsInt() : 0;
            JsonObject l = o.has("last") && o.get("last").isJsonObject() ? o.getAsJsonObject("last") : null;
            last = l == null ? "" : (l.has("mine") && l.get("mine").getAsBoolean() ? "Ty: " : "") + str(l, "text");
        }
    }

    public static final class Message {
        public final String text;
        public final boolean mine;
        public final long ts;
        public final String state;

        Message(String text, boolean mine, long ts, String state) { this.text = text; this.mine = mine; this.ts = ts; this.state = state; }
    }

    /** An incoming message or a friend coming online, handed to the game thread. */
    public static final class Event {
        public final String type, hex, name, text;

        Event(String type, String hex, String name, String text) { this.type = type; this.hex = hex; this.name = name; this.text = text; }
    }

    private static final String ADDRESS = System.getProperty("noreclient.chatBridge", "");
    private static final ConcurrentLinkedQueue<Event> EVENTS = new ConcurrentLinkedQueue<Event>();
    private static final Map<String, List<Message>> HISTORY = new ConcurrentHashMap<String, List<Message>>();
    /** Conversations to reload (new message, delivery state) and ones being loaded right now. */
    private static final java.util.Set<String> STALE = ConcurrentHashMap.newKeySet(), LOADING = ConcurrentHashMap.newKeySet();
    private static volatile List<Contact> contacts = Collections.emptyList();
    private static volatile String myName = "", myId = "";
    private static volatile boolean connected;
    private static String base, token;
    private static boolean started;

    private LauncherChat() {}

    private static String str(JsonObject o, String k) {
        return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : "";
    }

    /** True when the game was started by a launcher with the chat bridge. */
    public static boolean available() { return ADDRESS.contains(":"); }

    public static boolean connected() { return connected; }

    public static List<Contact> contacts() { return contacts; }

    public static String myName() { return myName; }

    public static String myId() { return myId; }

    public static int unread() {
        int n = 0;
        for (Contact c : contacts) n += c.unread;
        return n;
    }

    /** Starts the background poller once. */
    public static synchronized void start() {
        if (started || !available()) return;
        started = true;
        int i = ADDRESS.indexOf(':');
        base = "http://127.0.0.1:" + ADDRESS.substring(0, i);
        token = ADDRESS.substring(i + 1);
        Thread t = new Thread(LauncherChat::loop, "Nore Chat");
        t.setDaemon(true);
        t.start();
    }

    /** Local bridge request (HttpURLConnection: Java 8, works on every Minecraft version). */
    private static String request(String method, String path, String body, int timeoutSec) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(base + path).openConnection();
        c.setConnectTimeout(3000);
        c.setReadTimeout(timeoutSec * 1000);
        c.setRequestMethod(method);
        c.setRequestProperty("X-Nore-Token", token);
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = c.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new IllegalStateException("HTTP " + code);
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] b = new byte[8192];
                for (int n; (n = in.read(b)) > 0; ) buf.write(b, 0, n);
                return new String(buf.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally {
            c.disconnect();
        }
    }

    private static JsonObject get(String path, int timeoutSec) throws Exception {
        return Json.parse(request("GET", path, null, timeoutSec)).getAsJsonObject();
    }

    private static void post(String path, JsonObject body) {
        if (base == null) return;
        final String json = body.toString();
        Thread t = new Thread(() -> {
            try {
                request("POST", path, json, 5);
                refreshState();
            } catch (Exception ignored) { /* next poll */ }
        }, "Nore Chat send");
        t.setDaemon(true);
        t.start();
    }

    private static void refreshState() throws Exception {
        JsonObject s = get("/v1/state", 5);
        JsonObject me = s.getAsJsonObject("me");
        myName = str(me, "name");
        myId = str(me, "id");
        List<Contact> list = new ArrayList<Contact>();
        for (JsonElement e : s.getAsJsonArray("contacts")) list.add(new Contact(e.getAsJsonObject()));
        list.sort((a, b) -> a.online != b.online ? (a.online ? -1 : 1) : a.name.compareToIgnoreCase(b.name));
        contacts = Collections.unmodifiableList(list);
        connected = true;
    }

    private static void loop() {
        long since = -1;
        while (true) {
            try {
                if (since < 0) {
                    refreshState();
                    since = get("/v1/events?since=" + Integer.MAX_VALUE, 5).get("seq").getAsLong();
                }
                JsonObject r = get("/v1/events?since=" + since, 35);
                long seq = r.get("seq").getAsLong();
                JsonArray evs = r.getAsJsonArray("events");
                for (JsonElement e : evs) {
                    JsonObject o = e.getAsJsonObject();
                    EVENTS.add(new Event(str(o, "type"), str(o, "hex"), str(o, "name"), str(o, "text")));
                    STALE.add(str(o, "hex"));
                }
                since = seq;
                refreshState();
            } catch (Exception e) {
                connected = false;
                since = -1;
                try { Thread.sleep(5000); } catch (InterruptedException ie) { return; }
            }
        }
    }

    /** Hands queued events to the caller (game thread). */
    public static void drain(Consumer<Event> sink) {
        Event e;
        while ((e = EVENTS.poll()) != null) sink.accept(e);
    }

    /** Cached conversation (kept while a newer copy loads in the background). */
    public static List<Message> history(String hex) {
        List<Message> h = HISTORY.get(hex);
        if ((h == null || STALE.contains(hex)) && base != null && LOADING.add(hex)) {
            STALE.remove(hex);
            Thread t = new Thread(() -> {
                try {
                    JsonObject r = get("/v1/history?limit=80&hex=" + hex, 5);
                    List<Message> list = new ArrayList<Message>();
                    for (JsonElement e : r.getAsJsonArray("messages")) {
                        JsonObject o = e.getAsJsonObject();
                        list.add(new Message(str(o, "text"), o.has("mine") && o.get("mine").getAsBoolean(), o.has("ts") ? o.get("ts").getAsLong() : 0, str(o, "state")));
                    }
                    HISTORY.put(hex, Collections.unmodifiableList(list));
                } catch (Exception ignored) {
                    STALE.add(hex);
                } finally {
                    LOADING.remove(hex);
                }
            }, "Nore Chat history");
            t.setDaemon(true);
            t.start();
        }
        return h != null ? h : Collections.<Message>emptyList();
    }

    /** True while a conversation is loaded for the first time. */
    public static boolean loading(String hex) { return !HISTORY.containsKey(hex) && LOADING.contains(hex); }

    public static void send(String hex, String text) {
        text = text.trim();
        if (text.isEmpty()) return;
        List<Message> h = new ArrayList<Message>(history(hex));
        h.add(new Message(text, true, System.currentTimeMillis(), "pending"));
        HISTORY.put(hex, Collections.unmodifiableList(h));
        JsonObject b = new JsonObject();
        b.addProperty("hex", hex);
        b.addProperty("text", text.length() > 2000 ? text.substring(0, 2000) : text);
        post("/v1/send", b);
        // reload with the launcher's delivery state a moment later
        Thread t = new Thread(() -> { try { Thread.sleep(1500); } catch (InterruptedException ignored) { /* exit */ } STALE.add(hex); }, "Nore Chat refresh");
        t.setDaemon(true);
        t.start();
    }

    public static void markRead(String hex) {
        JsonObject b = new JsonObject();
        b.addProperty("hex", hex);
        post("/v1/read", b);
    }
}
