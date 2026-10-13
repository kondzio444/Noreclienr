package dev.noreclient.util;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.ByteChannel;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Minimal Discord Rich Presence client speaking Discord's local IPC protocol directly (named pipe
 * on Windows, unix socket elsewhere), so it needs no native library and runs on Java 8+.
 * All work happens on one daemon thread; {@link #update} only stores the wanted activity.
 */
public final class DiscordIpc {
    private static final int OP_HANDSHAKE = 0, OP_FRAME = 1, OP_CLOSE = 2;

    private static volatile String appId;
    private static volatile JsonObject wanted;
    private static volatile boolean dirty, running;
    private static Thread thread;

    private DiscordIpc() {}

    /** Sets the activity to show (null clears it). Starts the worker on first use. */
    public static synchronized void update(String applicationId, JsonObject activity) {
        if (applicationId == null || applicationId.trim().isEmpty()) return;
        if (!applicationId.equals(appId)) {
            appId = applicationId.trim();
            dirty = true;
        }
        String a = activity == null ? "" : activity.toString();
        String w = wanted == null ? "" : wanted.toString();
        if (!a.equals(w)) {
            wanted = activity;
            dirty = true;
        }
        if (!running) {
            running = true;
            thread = new Thread(DiscordIpc::loop, "Nore Discord RPC");
            thread.setDaemon(true);
            thread.start();
        }
    }

    public static void stop() {
        running = false;
        if (thread != null) thread.interrupt();
    }

    // ------------------------------------------------------------------ worker

    private interface Pipe extends Closeable {
        void write(byte[] data) throws IOException;

        void readFully(byte[] data) throws IOException;
    }

    private static void loop() {
        while (running) {
            String id = appId;
            try (Pipe pipe = connect()) {
                if (pipe == null) {
                    sleep(15000);
                    continue;
                }
                JsonObject hs = new JsonObject();
                hs.addProperty("v", 1);
                hs.addProperty("client_id", id);
                send(pipe, OP_HANDSHAKE, hs);
                if (read(pipe) == null) throw new IOException("no READY");
                dirty = true;
                while (running && id.equals(appId)) {
                    if (dirty) {
                        dirty = false;
                        JsonObject args = new JsonObject();
                        args.addProperty("pid", pid());
                        if (wanted != null) args.add("activity", wanted);
                        JsonObject cmd = new JsonObject();
                        cmd.addProperty("cmd", "SET_ACTIVITY");
                        cmd.add("args", args);
                        cmd.addProperty("nonce", UUID.randomUUID().toString());
                        send(pipe, OP_FRAME, cmd);
                        read(pipe);
                    }
                    sleep(1000);
                }
            } catch (Exception e) {
                // Discord closed or not running: retry later
                sleep(15000);
            }
        }
    }

    private static void send(Pipe pipe, int op, JsonObject json) throws IOException {
        byte[] body = json.toString().getBytes(StandardCharsets.UTF_8);
        ByteBuffer b = ByteBuffer.allocate(8 + body.length).order(ByteOrder.LITTLE_ENDIAN);
        b.putInt(op).putInt(body.length).put(body);
        pipe.write(b.array());
    }

    private static JsonObject read(Pipe pipe) throws IOException {
        byte[] head = new byte[8];
        pipe.readFully(head);
        ByteBuffer b = ByteBuffer.wrap(head).order(ByteOrder.LITTLE_ENDIAN);
        int op = b.getInt(), len = b.getInt();
        if (len < 0 || len > 1 << 20) throw new IOException("bad frame");
        byte[] body = new byte[len];
        pipe.readFully(body);
        if (op == OP_CLOSE) throw new IOException("closed by Discord");
        return new JsonParser().parse(new String(body, StandardCharsets.UTF_8)).getAsJsonObject();
    }

    private static Pipe connect() {
        boolean windows = System.getProperty("os.name", "").toLowerCase().contains("win");
        for (int i = 0; i < 10; i++) {
            try {
                Pipe p = windows ? windowsPipe("\\\\?\\pipe\\discord-ipc-" + i) : unixPipe(i);
                if (p != null) return p;
            } catch (Exception ignored) {
                // try the next index
            }
        }
        return null;
    }

    private static Pipe windowsPipe(String path) throws IOException {
        final RandomAccessFile f = new RandomAccessFile(path, "rw");
        return new Pipe() {
            @Override public void write(byte[] data) throws IOException { f.write(data); }

            @Override public void readFully(byte[] data) throws IOException { f.readFully(data); }

            @Override public void close() throws IOException { f.close(); }
        };
    }

    /** Unix sockets need Java 16+; reached through reflection so the core still targets Java 8. */
    private static Pipe unixPipe(int index) throws Exception {
        String[] bases = {System.getenv("XDG_RUNTIME_DIR"), System.getenv("TMPDIR"), System.getenv("TMP"), System.getenv("TEMP"), "/tmp"};
        String[] subs = {"", "app/com.discordapp.Discord/", "snap.discord/", ".flatpak/com.discordapp.Discord/xdg-run/"};
        for (String base : bases) {
            if (base == null) continue;
            for (String sub : subs) {
                File sock = new File(base, sub + "discord-ipc-" + index);
                if (!sock.exists()) continue;
                Class<?> addrCls = Class.forName("java.net.UnixDomainSocketAddress");
                Object addr = addrCls.getMethod("of", String.class).invoke(null, sock.getPath());
                Class<?> family = Class.forName("java.net.StandardProtocolFamily");
                Object unix = family.getField("UNIX").get(null);
                Method open = java.nio.channels.SocketChannel.class.getMethod("open", java.net.ProtocolFamily.class);
                final java.nio.channels.SocketChannel ch = (java.nio.channels.SocketChannel) open.invoke(null, unix);
                ch.connect((java.net.SocketAddress) addr);
                return channelPipe(ch);
            }
        }
        return null;
    }

    private static Pipe channelPipe(final ByteChannel ch) {
        return new Pipe() {
            @Override public void write(byte[] data) throws IOException {
                ByteBuffer b = ByteBuffer.wrap(data);
                while (b.hasRemaining()) ch.write(b);
            }

            @Override public void readFully(byte[] data) throws IOException {
                ByteBuffer b = ByteBuffer.wrap(data);
                while (b.hasRemaining()) if (ch.read(b) < 0) throw new IOException("EOF");
            }

            @Override public void close() throws IOException { ch.close(); }
        };
    }

    private static long pid() {
        String name = java.lang.management.ManagementFactory.getRuntimeMXBean().getName();
        try {
            return Long.parseLong(name.substring(0, name.indexOf('@')));
        } catch (Exception e) {
            return 0;
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            // stop() interrupts the worker
        }
    }
}
