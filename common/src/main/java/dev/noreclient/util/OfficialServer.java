package dev.noreclient.util;

import java.util.List;
import java.util.Locale;

/**
 * The official partner server of Nore Client. It is always pinned in the server list: the
 * platforms put it back into servers.dat when it is missing (without duplicating an entry the
 * player added by hand) and the multiplayer screen shows it in its own section.
 */
public final class OfficialServer {
    /** Display name of the server. */
    public static final String NAME = "Nore MC";
    /** Address saved in servers.dat. */
    public static final String ADDRESS = "mc.noreclient.pl";
    /** Short description shown next to the server. */
    public static final String TAGLINE = "Oficjalny serwer partnerski Nore Client";
    /** Tooltip on the disabled edit / delete / move actions. */
    public static final String LOCKED = "Oficjalny serwer jest przypięty na stałe – nie można go edytować, usunąć ani przesunąć.";

    private OfficialServer() {}

    /** True when the address points at the official server ("MC.NoreClient.pl", "mc.noreclient.pl:25565", ...). */
    public static boolean matches(String address) {
        if (address == null) return false;
        String a = address.trim().toLowerCase(Locale.ROOT);
        if (a.endsWith(":25565")) a = a.substring(0, a.length() - 6);
        while (a.endsWith(".")) a = a.substring(0, a.length() - 1);
        return a.equals(ADDRESS);
    }

    /** Index of the first entry ({name, address}) that is the official server, or -1. */
    public static int indexIn(List<String[]> servers) {
        if (servers == null) return -1;
        for (int i = 0; i < servers.size(); i++) if (servers.get(i) != null && matches(servers.get(i)[1])) return i;
        return -1;
    }

    /** Address variants a hidden ("Direct Connection") entry of the official server may be stored under. */
    public static final String[] HIDDEN_ALIASES = {ADDRESS, ADDRESS + ":25565"};
}
