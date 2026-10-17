package dev.noreclient.util;

import com.google.gson.JsonObject;

import java.util.Collection;

/**
 * Nore Hub client (docs/nore-hub.md): which players around us also play with Nore, and what they
 * wear. Lookups run on a background thread; every getter is a cheap cache read that never blocks,
 * so renderers may call it every frame.
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

    private NoreHub() {}

    /** Names currently around the player (tab list, nearby players); unknown ones are looked up in batches. */
    public static void observe(Collection<String> names) {}

    /** Cached entry for a name (case-insensitive), or null when not a Nore user / not looked up yet. */
    public static Entry get(String name) { return null; }

    public static boolean isNore(String name) { return get(name) != null; }

    /** Publishes the local player's wardrobe through the launcher bridge (no-op without the launcher). */
    public static void publish(JsonObject cosmetics) {}
}
