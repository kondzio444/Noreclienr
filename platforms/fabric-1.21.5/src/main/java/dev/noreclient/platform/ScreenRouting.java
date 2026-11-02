package dev.noreclient.platform;

import java.lang.ref.WeakReference;

/** One-shot switches for screens the client normally replaces. */
public final class ScreenRouting {
    private ScreenRouting() {}

    /** Set right before opening the original multiplayer list on purpose. */
    public static boolean allowVanilla;

    private static WeakReference<Object> vanilla = new WeakReference<Object>(null);
    private static WeakReference<Object> shown = new WeakReference<Object>(null);

    /**
     * Whether a vanilla multiplayer screen stays vanilla: when it was opened on purpose ("Klasyczna
     * lista"), when the same instance comes back (after its Add / Edit / Delete dialogs or a failed
     * join) and for its own refresh. Without this the vanilla list jumped to the Nore list after
     * every edit, so the two lists looked out of sync.
     */
    public static boolean keepVanilla(Object screen) {
        Object v = vanilla.get();
        boolean keep = allowVanilla || (v != null && (screen == v || shown.get() == v));
        allowVanilla = false;
        if (keep) vanilla = new WeakReference<Object>(screen);
        return keep;
    }

    /** The screen that setScreen finally shows (null = the game). */
    public static void shown(Object screen) {
        shown = new WeakReference<Object>(screen);
    }
}
