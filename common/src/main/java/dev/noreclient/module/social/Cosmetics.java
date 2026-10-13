package dev.noreclient.module.social;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.util.Capes;

/** Nore capes for the local player (also on the elytra). */
public class Cosmetics extends Module {
    public final ModeSetting cape = add(new ModeSetting("Cape", "Peleryna Nore", "Nore Orange", Capes.NAMES));
    private String applied;

    public Cosmetics() {
        super("Cosmetics", "Peleryny Nore Client", Category.CLIENT);
        setEnabled(true);
    }

    @Override
    public void onTick() {
        String want = isEnabled() ? cape.get() : Capes.NAMES[0];
        if (want.equals(applied)) return;
        applied = want;
        game().setLocalCape(Capes.texture(want));
    }

    @Override
    protected void onDisable() {
        applied = null;
        game().setLocalCape(null);
    }
}
