package dev.noreclient.platform;

/** One-shot switches for screens the client normally replaces. */
public final class ScreenRouting {
    private ScreenRouting() {}

    /** Set right before opening the original multiplayer list on purpose. */
    public static boolean allowVanilla;

    public static boolean consumeVanilla() {
        boolean v = allowVanilla;
        allowVanilla = false;
        return v;
    }
}
