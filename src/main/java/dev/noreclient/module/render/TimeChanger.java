package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;

/** Client-side only time of day. */
public class TimeChanger extends Module {
    public final ModeSetting preset = add(new ModeSetting("Preset", "Gotowa pora dnia", "Day", "Day", "Sunset", "Night", "Sunrise", "Custom"));
    public final NumberSetting time = add(new NumberSetting("Time", "Własny czas (ticki)", 6000, 0, 24000, 100)).visibleWhen(() -> preset.is("Custom"));

    public TimeChanger() {
        super("Time Changer", "Zmienia porę dnia tylko u Ciebie", Category.RENDER);
    }

    public long getTime() {
        return switch (preset.get()) {
            case "Sunset" -> 12500;
            case "Night" -> 18000;
            case "Sunrise" -> 23200;
            case "Custom" -> time.get().longValue();
            default -> 6000;
        };
    }

    @Override
    public String getSuffix() { return preset.get(); }
}
