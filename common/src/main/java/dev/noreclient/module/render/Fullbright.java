package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.api.Keys;

/** Overrides the gamma option without touching options.txt (see SimpleOptionMixin). */
public class Fullbright extends Module {
    public final NumberSetting gamma = add(new NumberSetting("Brightness", "Poziom jasności", 15, 1, 20, 0.5));

    public Fullbright() {
        super("Fullbright", "Pełna jasność w ciemnych miejscach", Category.RENDER, Keys.B);
    }

    public double getGamma() { return gamma.get(); }

    @Override
    protected boolean needsHook() { return true; }
}
