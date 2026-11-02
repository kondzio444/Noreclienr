package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;

public class CameraTweaks extends Module {
    public final NumberSetting distance = add(new NumberSetting("Third Person Distance", "Odległość kamery w trzeciej osobie", 4, 1, 12, 0.5, " bl"));
    public final BooleanSetting noClip = add(new BooleanSetting("Camera Clip", "Kamera przenika przez bloki", true));

    public CameraTweaks() {
        super("Camera Tweaks", "Odległość kamery F5 i przenikanie przez ściany", Category.RENDER);
    }

    @Override
    protected boolean needsHook() { return true; }
}
