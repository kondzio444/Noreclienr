package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;

/** Client-side only time of day. */
public class TimeChanger extends Module {
    public final ModeSetting preset = add(new ModeSetting("Preset", "Gotowa pora dnia", "Day", "Day", "Sunset", "Night", "Sunrise", "Custom"));
    public final NumberSetting time = add(new NumberSetting("Time", "Własny czas (ticki)", 6000, 0, 24000, 100));

    public TimeChanger() {
        super("Time Changer", "Zmienia porę dnia tylko u Ciebie", Category.RENDER);
        time.visibleWhen(() -> preset.is("Custom"));
    }

    public long getTime() {
        String p = preset.get();
        if ("Sunset".equals(p)) return 12500;
        if ("Night".equals(p)) return 18000;
        if ("Sunrise".equals(p)) return 23200;
        if ("Custom".equals(p)) return time.get().longValue();
        return 6000;
    }

    @Override
    public String getSuffix() { return preset.get(); }

    @Override
    protected boolean needsHook() { return true; }
}
