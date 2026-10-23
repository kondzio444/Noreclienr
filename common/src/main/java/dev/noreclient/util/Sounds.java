package dev.noreclient.util;

import dev.noreclient.api.Platform;

public final class Sounds {
    private Sounds() {}

    public static void click() {
        if (Theme.sounds()) Platform.game().playClick(1.0f);
    }

    public static void toggle(boolean on) {
        if (Theme.sounds()) Platform.game().playClick(on ? 1.4f : 0.9f);
    }
}
