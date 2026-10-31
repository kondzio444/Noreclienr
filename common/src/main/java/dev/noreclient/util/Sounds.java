package dev.noreclient.util;

import dev.noreclient.api.Platform;

/** GUI sounds, all behind {@link Theme#sounds()}. */
public final class Sounds {
    private Sounds() {}

    public static void click() {
        if (Theme.sounds()) Platform.game().playClick(1.0f);
    }

    /** Stick (on) is a soft low "pap", peel (off) a short higher rip. */
    public static void toggle(boolean on) {
        if (on) stick(); else peel();
    }

    /** Sticker slapped into its slot: the UI click pitched down. */
    public static void stick() {
        if (Theme.sounds()) Platform.game().playClick(0.72f);
    }

    /** Sticker peeled off: very short and higher. */
    public static void peel() {
        if (Theme.sounds()) Platform.game().playClick(1.55f);
    }

    /** Page turn (screen / tab change). */
    public static void page() {
        if (Theme.sounds()) Platform.game().playClick(1.25f);
    }
}
