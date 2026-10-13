package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.NumberSetting;

public class LowFire extends Module {
    public final NumberSetting height = add(new NumberSetting("Offset", "Jak nisko przesunąć ogień", 0.3, 0.0, 0.6, 0.05));

    public LowFire() {
        super("Low Fire", "Obniża nakładkę ognia, by nie zasłaniała widoku", Category.RENDER);
    }
}
