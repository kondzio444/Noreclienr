package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;

public class FogControl extends Module {
    public final BooleanSetting worldFog = add(new BooleanSetting("Remove World Fog", "Usuń mgłę na krańcu zasięgu renderowania", true));
    public final NumberSetting distance = add(new NumberSetting("Fog Distance", "Odległość mgły (gdy nie usunięta)", 100, 50, 300, 10, "%")).visibleWhen(() -> !worldFog.isOn());
    public final BooleanSetting waterFog = add(new BooleanSetting("Clear Water", "Lepsza widoczność pod wodą", true));
    public final BooleanSetting lavaFog = add(new BooleanSetting("Clear Lava", "Widoczność w lawie", false));
    public final BooleanSetting snowFog = add(new BooleanSetting("Clear Powder Snow", "Widoczność w sypkim śniegu", false));

    public FogControl() {
        super("Fog Control", "Usuwa lub zmniejsza mgłę", Category.RENDER);
    }
}
