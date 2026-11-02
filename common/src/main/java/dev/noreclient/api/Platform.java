package dev.noreclient.api;

import java.util.HashSet;
import java.util.Set;

/**
 * Static access to the running platform. Set once by the platform entrypoint before the core is
 * initialised.
 */
public final class Platform {
    private static Game game;
    private static String name = "unknown";
    private static final Set<String> FEATURES = new HashSet<String>();

    private Platform() {}

    public static void init(Game g, String platformName, String... features) {
        game = g;
        name = platformName;
        for (String f : features) FEATURES.add(f);
    }

    public static Game game() { return game; }

    public static String name() { return name; }

    /** Feature ids are the module names whose hooks the platform implements. */
    public static boolean supports(String feature) {
        return FEATURES.contains(feature) || FEATURES.contains("*");
    }
}
