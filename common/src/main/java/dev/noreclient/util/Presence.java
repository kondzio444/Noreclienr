package dev.noreclient.util;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Platform;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

/**
 * Tells the Nore website that a game with Nore Client is running (POST /api/v2/presence), so the
 * "players online" counter also includes games started without Nore Launcher. Sends a random id of
 * this game session, the nick, the Minecraft and the Nore version – every 60 s while the game runs and
 * "online: false" when it closes. Never blocks the game; -Dnoreclient.presence=false turns it off.
 */
public final class Presence {
    private static final String BASE = trim(System.getProperty("noreclient.hub", "https://noreclient.pl"));
    private static final long BEAT_MS = 60_000L;
    private static final String SID = randomHex(16);
    private static volatile boolean started;

    private Presence() {}

    private static String trim(String s) {
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    private static String randomHex(int bytes) {
        byte[] b = new byte[bytes];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

    public static synchronized void start() {
        if (started || "false".equals(System.getProperty("noreclient.presence"))) return;
        started = true;
        Thread t = new Thread(Presence::loop, "Nore Presence");
        t.setDaemon(true);
        t.start();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> send(false), "Nore Presence exit"));
    }

    private static void loop() {
        while (true) {
            send(true);
            try { Thread.sleep(BEAT_MS); } catch (InterruptedException e) { return; }
        }
    }

    private static String esc(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static void send(boolean online) {
        HttpURLConnection c = null;
        try {
            StringBuilder body = new StringBuilder("{\"sid\":\"").append(SID).append("\",\"online\":").append(online);
            if (online) {
                String name = Platform.game() == null ? null : Platform.game().username();
                if (NoreHub.validName(name)) body.append(",\"name\":\"").append(name).append('"');
                if (Platform.game() != null) body.append(",\"mc\":\"").append(esc(Platform.game().minecraftVersion())).append('"');
                body.append(",\"version\":\"").append(esc(NoreClient.VERSION.replace(' ', '-'))).append('"');
            }
            body.append('}');
            c = (HttpURLConnection) new URL(BASE + "/api/v2/presence").openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("User-Agent", "NoreClient/" + NoreClient.VERSION.replace(' ', '-'));
            OutputStream out = c.getOutputStream();
            out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            out.close();
            c.getResponseCode();
        } catch (Exception ignored) {
            // offline or the site is down: the next beat tries again
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
