package dev.noreclient.module.social;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.cosmetic.Wardrobe;
import dev.noreclient.util.Capes;

/** Nore capes (also on the elytra), wings and hats from the wardrobe for the local player. */
public class Cosmetics extends Module {
    public final ModeSetting cape = add(new ModeSetting("Cape", "Peleryna Nore", "Nova 1.4", Capes.NAMES));
    public final ModeSetting wings = add(new ModeSetting("Wings", "Skrzydła (Szatnia)", Wardrobe.NONE, Wardrobe.WINGS));
    public final ModeSetting hat = add(new ModeSetting("Hat", "Czapka (Szatnia) – chowa się pod hełmem", Wardrobe.NONE, Wardrobe.HATS));
    public final BooleanSetting animated = add(new BooleanSetting("Animation", "Animowane peleryny z kolekcji Historia Nore i Halloween", true));
    private String applied;
    private int ticks;

    public Cosmetics() {
        super("Cosmetics", "Szatnia: peleryny, skrzydła i czapki Nore Client", Category.CLIENT);
        setEnabled(true);
    }

    @Override
    public void onTick() {
        String name = isEnabled() ? cape.get() : Capes.NAMES[0];
        int frame = animated.isOn() && Capes.isAnimated(name) ? ++ticks / 3 % Capes.FRAMES : 0;
        String want = name + "#" + frame;
        if (want.equals(applied)) return;
        applied = want;
        game().setLocalCape(Capes.texture(name, frame));
    }

    @Override
    protected void onDisable() {
        applied = null;
        game().setLocalCape(null);
    }
}
