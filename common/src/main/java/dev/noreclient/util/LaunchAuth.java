package dev.noreclient.util;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;

/**
 * Nore Client only runs when started by Nore Launcher. The launcher passes a signed, short-lived
 * session ticket (-Dnoreclient.session=time.nonce.signature); without a valid ticket the platform
 * does not apply any mixins and the client never starts.
 */
public final class LaunchAuth {
    private static final long MAX_AGE_MS = 30 * 60 * 1000L;
    private static Boolean cached;

    private LaunchAuth() {}

    private static byte[] key() {
        String[] p = {"65a21dccdb7cc1c0", "d27f3c431f20a116", "c2823186b96ef785", "ef73623d0c1dea4f"};
        StringBuilder sb = new StringBuilder();
        for (String s : p) sb.append(s);
        String hex = sb.toString();
        byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    /** True when this game was started by Nore Launcher with a valid session ticket. */
    public static synchronized boolean valid() {
        if (cached == null) cached = check(System.getProperty("noreclient.session", ""));
        return cached;
    }

    static boolean check(String ticket) {
        try {
            String[] parts = ticket.split("\\.");
            if (parts.length != 3) return false;
            long time = Long.parseLong(parts[0]);
            if (Math.abs(System.currentTimeMillis() - time) > MAX_AGE_MS) return false;
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key(), "HmacSHA256"));
            byte[] sig = mac.doFinal(("nore:" + parts[0] + ":" + parts[1]).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : sig) hex.append(String.format("%02x", b & 0xff));
            return constantEquals(hex.toString(), parts[2]);
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean constantEquals(String a, String b) {
        if (a.length() != b.length()) return false;
        int r = 0;
        for (int i = 0; i < a.length(); i++) r |= a.charAt(i) ^ b.charAt(i);
        return r == 0;
    }
}
