package dev.noreclient.module.client;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.NumberSetting;

/** Lower frame rate while the window is in the background: less heat, less noise, more battery. */
public class DynamicFps extends Module {
    public final NumberSetting unfocused = add(new NumberSetting("Background FPS", "Klatki na sekundę, gdy okno gry nie jest aktywne", 15, 1, 60, 1));

    public DynamicFps() {
        super("Dynamic FPS", "Mniej FPS w tle – chłodniejszy komputer i więcej mocy dla innych programów", Category.CLIENT);
        setEnabled(true);
    }

    public int limit(int current, boolean focused) {
        return focused ? current : Math.min(current, unfocused.intValue());
    }
}
