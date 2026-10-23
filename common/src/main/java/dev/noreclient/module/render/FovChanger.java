package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;

public class FovChanger extends Module {
    public final NumberSetting fov = add(new NumberSetting("FOV", "Pole widzenia", 90, 30, 140, 1, "°"));
    public final BooleanSetting staticFov = add(new BooleanSetting("Static FOV", "Ignoruj zmiany FOV od sprintu i efektów", true));

    public FovChanger() {
        super("FOV Changer", "Własne pole widzenia (też powyżej 110°)", Category.RENDER);
    }

    @Override
    protected boolean needsHook() { return true; }
}
