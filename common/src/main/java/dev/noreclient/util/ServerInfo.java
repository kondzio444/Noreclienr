package dev.noreclient.util;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.noreclient.NoreClient;
import dev.noreclient.api.Platform;
import dev.noreclient.api.TextureRef;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Hashtable;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Live information about a Minecraft server for menus and HUDs: MOTD, players, version, ping and
 * favicon (Server List Ping protocol, SRV records supported) plus the country of its IP with a
 * flag. Results are cached for a minute; everything runs in the background.
 */
public final class ServerInfo {
    public enum State { LOADING, ONLINE, OFFLINE }

    public static final class Info {
        public volatile State state = State.LOADING;
        public volatile String address, host, ip, motd = "", version = "", error;
        public volatile int online = -1, max = -1, protocol;
        public volatile long ping = -1;
        public volatile List<String> sample = new ArrayList<String>();
        public volatile TextureRef favicon;
        public volatile String country, countryCode, city, isp;
        public volatile TextureRef flag;
        volatile long fetched;
    }

    private static final Map<String, Info> CACHE = new ConcurrentHashMap<String, Info>();
    private static final Map<String, Object> FLAGS = new ConcurrentHashMap<String, Object>();
    private static final ExecutorService POOL = Executors.newFixedThreadPool(3, r -> {
        Thread t = new Thread(r, "Nore-ServerInfo");
        t.setDaemon(true);
        return t;
    });
    private static final long TTL = 60_000;

    private ServerInfo() {}

    /** Cached info for an address ("host", "host:port"); starts a refresh when missing or stale. */
    public static Info get(String address) {
        if (address == null) return null;
        final String key = address.trim().toLowerCase(Locale.ROOT);
        if (key.isEmpty()) return null;
        Info info = CACHE.get(key);
        if (info == null || (info.state != State.LOADING && System.currentTimeMillis() - info.fetched > TTL)) {
            final Info fresh = new Info();
            fresh.address = key;
            if (info != null) { // keep showing the old data while refreshing
                fresh.motd = info.motd; fresh.online = info.online; fresh.max = info.max; fresh.version = info.version;
                fresh.favicon = info.favicon; fresh.country = info.country; fresh.countryCode = info.countryCode; fresh.flag = info.flag;
                fresh.ping = info.ping; fresh.city = info.city; fresh.sample = info.sample;
            }
            fresh.fetched = System.currentTimeMillis();
            CACHE.put(key, fresh);
            POOL.execute(() -> query(fresh));
            info = fresh;
        }
        return info;
    }

    /** Forces a new query next time {@link #get} is called. */
    public static void invalidate(String address) {
        if (address != null) CACHE.remove(address.trim().toLowerCase(Locale.ROOT));
    }

    /** True when the text could be a server address (host or host:port). */
    public static boolean looksLikeAddress(String s) {
        return s != null && s.trim().matches("[A-Za-z0-9._-]+\\.[A-Za-z0-9-]{2,}(:\\d{1,5})?|\\[?[0-9a-fA-F:]+\\]?(:\\d{1,5})?|localhost(:\\d{1,5})?");
    }

    // ------------------------------------------------------------------ query

    private static void query(Info info) {
        String host = info.address;
        int port = 25565;
        int colon = host.lastIndexOf(':');
        boolean explicitPort = colon > 0 && host.indexOf(':') == colon;
        if (explicitPort) {
            try { port = Integer.parseInt(host.substring(colon + 1)); } catch (NumberFormatException ignored) { }
            host = host.substring(0, colon);
        }
        String connectHost = host;
        int connectPort = port;
        if (!explicitPort) {
            String[] srv = srv(host);
            if (srv != null) { connectHost = srv[0]; connectPort = Integer.parseInt(srv[1]); }
        }
        info.host = host;
        try {
            InetAddress addr = InetAddress.getByName(connectHost);
            info.ip = addr.getHostAddress();
            ping(info, addr, host, connectPort);
            info.state = State.ONLINE;
        } catch (Throwable t) {
            info.error = t instanceof java.net.UnknownHostException ? "Nieznany adres" : "Serwer nie odpowiada";
            info.state = State.OFFLINE;
        }
        info.fetched = System.currentTimeMillis();
        if (info.ip != null && info.countryCode == null) geo(info);
    }

    private static String[] srv(String host) {
        try {
            Hashtable<String, String> env = new Hashtable<String, String>();
            env.put("java.naming.factory.initial", "com.sun.jndi.dns.DnsContextFactory");
            env.put("java.naming.provider.url", "dns:");
            env.put("com.sun.jndi.dns.timeout.initial", "1500");
            env.put("com.sun.jndi.dns.timeout.retries", "1");
            javax.naming.directory.DirContext ctx = new javax.naming.directory.InitialDirContext(env);
            javax.naming.directory.Attribute a = ctx.getAttributes("_minecraft._tcp." + host, new String[]{"SRV"}).get("srv");
            if (a == null) return null;
            String[] parts = a.get().toString().split(" ");
            String target = parts[3].endsWith(".") ? parts[3].substring(0, parts[3].length() - 1) : parts[3];
            return new String[]{target, parts[2]};
        } catch (Throwable t) {
            return null;
        }
    }

    private static void writeVarInt(DataOutputStream out, int v) throws IOException {
        while ((v & ~0x7F) != 0) { out.writeByte((v & 0x7F) | 0x80); v >>>= 7; }
        out.writeByte(v);
    }

    private static int readVarInt(DataInputStream in) throws IOException {
        int value = 0, pos = 0;
        while (true) {
            byte b = in.readByte();
            value |= (b & 0x7F) << pos;
            if ((b & 0x80) == 0) return value;
            pos += 7;
            if (pos >= 32) throw new IOException("VarInt too big");
        }
    }

    private static void ping(Info info, InetAddress addr, String host, int port) throws IOException {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(addr, port), 4000);
            s.setSoTimeout(4000);
            DataOutputStream out = new DataOutputStream(s.getOutputStream());
            DataInputStream in = new DataInputStream(s.getInputStream());
            ByteArrayOutputStream hsBytes = new ByteArrayOutputStream();
            DataOutputStream hs = new DataOutputStream(hsBytes);
            hs.writeByte(0x00);
            writeVarInt(hs, 767);
            byte[] h = host.getBytes(StandardCharsets.UTF_8);
            writeVarInt(hs, h.length);
            hs.write(h);
            hs.writeShort(port);
            writeVarInt(hs, 1);
            writeVarInt(out, hsBytes.size());
            out.write(hsBytes.toByteArray());
            out.writeByte(0x01); // status request: length 1, id 0
            out.writeByte(0x00);
            out.flush();
            readVarInt(in);
            if (readVarInt(in) != 0x00) throw new IOException("Bad response");
            byte[] json = new byte[readVarInt(in)];
            in.readFully(json);
            parseStatus(info, new String(json, StandardCharsets.UTF_8));
            long t0 = System.nanoTime();
            out.writeByte(0x09);
            out.writeByte(0x01);
            out.writeLong(System.currentTimeMillis());
            out.flush();
            try {
                readVarInt(in);
                readVarInt(in);
                in.readLong();
                info.ping = (System.nanoTime() - t0) / 1_000_000;
            } catch (IOException e) {
                info.ping = (System.nanoTime() - t0) / 1_000_000;
            }
        }
    }

    private static void parseStatus(Info info, String json) {
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();
        if (o.has("version")) {
            JsonObject v = o.getAsJsonObject("version");
            info.version = v.has("name") ? v.get("name").getAsString() : "";
            info.protocol = v.has("protocol") ? v.get("protocol").getAsInt() : 0;
        }
        if (o.has("players")) {
            JsonObject p = o.getAsJsonObject("players");
            info.online = p.has("online") ? p.get("online").getAsInt() : 0;
            info.max = p.has("max") ? p.get("max").getAsInt() : 0;
            List<String> names = new ArrayList<String>();
            if (p.has("sample") && p.get("sample").isJsonArray()) {
                for (JsonElement e : p.getAsJsonArray("sample")) {
                    if (e.isJsonObject() && e.getAsJsonObject().has("name")) names.add(e.getAsJsonObject().get("name").getAsString());
                }
            }
            info.sample = names;
        }
        if (o.has("description")) {
            StringBuilder sb = new StringBuilder();
            legacy(o.get("description"), sb, "");
            info.motd = sb.toString().replace("\r", "");
        }
        if (o.has("favicon") && o.get("favicon").isJsonPrimitive()) {
            String fav = o.get("favicon").getAsString();
            int comma = fav.indexOf(',');
            if (comma > 0) {
                final byte[] png = Base64.getMimeDecoder().decode(fav.substring(comma + 1));
                final String key = "server/" + Integer.toHexString(info.address.hashCode());
                NoreClient.runNextTick(() -> info.favicon = Platform.game().loadTexture(key, png));
            }
        }
    }

    private static final String[][] COLORS = {
            {"black", "0"}, {"dark_blue", "1"}, {"dark_green", "2"}, {"dark_aqua", "3"}, {"dark_red", "4"}, {"dark_purple", "5"}, {"gold", "6"}, {"gray", "7"},
            {"dark_gray", "8"}, {"blue", "9"}, {"green", "a"}, {"aqua", "b"}, {"red", "c"}, {"light_purple", "d"}, {"yellow", "e"}, {"white", "f"}};

    /** Chat component JSON → legacy text with § codes (the font renderer understands them). */
    private static void legacy(JsonElement e, StringBuilder sb, String inherited) {
        if (e == null || e.isJsonNull()) return;
        if (e.isJsonPrimitive()) { sb.append(inherited).append(e.getAsString()); return; }
        if (e.isJsonArray()) { for (JsonElement x : (JsonArray) e) legacy(x, sb, inherited); return; }
        JsonObject o = e.getAsJsonObject();
        StringBuilder fmt = new StringBuilder(inherited);
        if (o.has("color")) {
            String c = o.get("color").getAsString();
            String code = null;
            for (String[] p : COLORS) if (p[0].equals(c)) code = p[1];
            if (code == null && c.startsWith("#") && c.length() == 7) code = nearest(Integer.parseInt(c.substring(1), 16));
            if (code != null) { fmt.setLength(0); fmt.append('§').append(code); }
        }
        if (o.has("bold") && o.get("bold").getAsBoolean()) fmt.append("§l");
        if (o.has("italic") && o.get("italic").getAsBoolean()) fmt.append("§o");
        if (o.has("underlined") && o.get("underlined").getAsBoolean()) fmt.append("§n");
        if (o.has("strikethrough") && o.get("strikethrough").getAsBoolean()) fmt.append("§m");
        if (o.has("text")) sb.append(fmt).append(o.get("text").getAsString());
        if (o.has("extra")) for (JsonElement x : o.getAsJsonArray("extra")) legacy(x, sb, fmt.toString());
        sb.append("§r");
    }

    private static final int[] PALETTE = {0x000000, 0x0000AA, 0x00AA00, 0x00AAAA, 0xAA0000, 0xAA00AA, 0xFFAA00, 0xAAAAAA, 0x555555, 0x5555FF, 0x55FF55, 0x55FFFF, 0xFF5555, 0xFF55FF, 0xFFFF55, 0xFFFFFF};

    private static String nearest(int rgb) {
        int best = 15, bestD = Integer.MAX_VALUE;
        for (int i = 0; i < PALETTE.length; i++) {
            int dr = ((rgb >> 16) & 255) - ((PALETTE[i] >> 16) & 255), dg = ((rgb >> 8) & 255) - ((PALETTE[i] >> 8) & 255), db = (rgb & 255) - (PALETTE[i] & 255);
            int d = dr * dr + dg * dg + db * db;
            if (d < bestD) { bestD = d; best = i; }
        }
        return Integer.toHexString(best);
    }

    // ------------------------------------------------------------------ country + flag

    private static void geo(Info info) {
        try {
            JsonObject o = JsonParser.parseString(Modrinth.get("https://ipwho.is/" + info.ip + "?fields=success,country,country_code,city,connection")).getAsJsonObject();
            if (o.has("success") && o.get("success").getAsBoolean()) {
                info.country = o.get("country").getAsString();
                info.countryCode = o.get("country_code").getAsString().toLowerCase(Locale.ROOT);
                info.city = o.has("city") ? o.get("city").getAsString() : null;
                if (o.has("connection") && o.getAsJsonObject("connection").has("isp")) info.isp = o.getAsJsonObject("connection").get("isp").getAsString();
            }
        } catch (Throwable ignored) {
            // try the second provider below
        }
        if (info.countryCode == null) {
            try {
                JsonObject o = JsonParser.parseString(Modrinth.get("http://ip-api.com/json/" + info.ip + "?fields=status,country,countryCode,city,isp")).getAsJsonObject();
                if ("success".equals(o.get("status").getAsString())) {
                    info.country = o.get("country").getAsString();
                    info.countryCode = o.get("countryCode").getAsString().toLowerCase(Locale.ROOT);
                    info.city = o.has("city") ? o.get("city").getAsString() : null;
                    info.isp = o.has("isp") ? o.get("isp").getAsString() : null;
                }
            } catch (Throwable ignored) {
                return;
            }
        }
        if (info.countryCode != null) info.flag = flag(info.countryCode);
        if (info.flag == null && info.countryCode != null) {
            // the flag texture is still loading: pick it up on a later frame
            final Info target = info;
            POOL.execute(() -> {
                for (int i = 0; i < 40 && target.flag == null; i++) {
                    try { Thread.sleep(250); } catch (InterruptedException e) { return; }
                    target.flag = flag(target.countryCode);
                }
            });
        }
    }

    /** Flag texture for a two-letter country code (null while loading). */
    public static TextureRef flag(final String cc) {
        if (cc == null || !cc.matches("[a-z]{2}")) return null;
        Object o = FLAGS.get(cc);
        if (o instanceof TextureRef) return (TextureRef) o;
        if (o != null) return null;
        FLAGS.put(cc, "loading");
        POOL.execute(() -> {
            try {
                final byte[] png = Modrinth.getBytes("https://flagcdn.com/w40/" + cc + ".png");
                NoreClient.runNextTick(() -> {
                    TextureRef t = Platform.game().loadTexture("flag/" + cc, png);
                    if (t != null) FLAGS.put(cc, t); else FLAGS.put(cc, Boolean.FALSE);
                });
            } catch (Throwable t) {
                FLAGS.put(cc, Boolean.FALSE);
            }
        });
        return null;
    }

    /** Draws a flag (or a grey placeholder) with a thin border, height h. */
    public static void drawFlag(dev.noreclient.api.Gfx g, Info info, float x, float y, float h) {
        float w = h * 1.5f;
        TextureRef f = info == null ? null : info.flag;
        if (f == null && info != null && info.countryCode != null) f = info.flag = flag(info.countryCode);
        if (f != null) {
            Render2D.rect(g, x - 0.5f, y - 0.5f, w + 1, h + 1, 0x60000000);
            Render2D.texture(g, f, x, y, w, h, 1f);
        } else {
            Render2D.roundedRect(g, x, y, w, h, 1, 0x40FFFFFF);
        }
    }

    /** Signal bars 0..4 from a ping in ms. */
    public static int bars(long ping) {
        if (ping < 0) return 0;
        return ping < 80 ? 4 : ping < 150 ? 3 : ping < 300 ? 2 : 1;
    }

    public static void drawBars(dev.noreclient.api.Gfx g, long ping, float x, float y, float h) {
        int b = bars(ping);
        int col = b >= 3 ? 0xFF55FF7A : b == 2 ? 0xFFFFD34D : 0xFFFF6B6B;
        for (int i = 0; i < 4; i++) {
            float bh = h * (0.35f + 0.65f * i / 3f);
            Render2D.rect(g, x + i * 3, y + h - bh, 2, bh, i < b ? col : 0x40FFFFFF);
        }
    }
}
