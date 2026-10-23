package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;

import java.util.Random;

/** Reduce or hide particle types for clarity and FPS. Platforms pass the particle id path. */
public class Particles extends Module {
    public final NumberSetting amount = add(new NumberSetting("Amount", "Ile cząsteczek wyświetlać", 100, 0, 100, 5, "%"));
    public final BooleanSetting explosions = add(new BooleanSetting("Explosions", "Cząsteczki wybuchów", true));
    public final BooleanSetting crits = add(new BooleanSetting("Critical Hits", "Cząsteczki trafień krytycznych", true));
    public final BooleanSetting enchant = add(new BooleanSetting("Enchant Hits", "Magiczne trafienia", true));
    public final BooleanSetting blockBreak = add(new BooleanSetting("Block Break", "Odłamki niszczonych bloków", true));
    public final BooleanSetting potions = add(new BooleanSetting("Potion Swirls", "Wiry efektów mikstur", true));
    public final BooleanSetting smoke = add(new BooleanSetting("Smoke", "Dym i para", true));
    public final BooleanSetting weather = add(new BooleanSetting("Rain Splashes", "Rozbryzgi deszczu", true));
    public final BooleanSetting totem = add(new BooleanSetting("Totem", "Cząsteczki totemu", true));
    public final NumberSetting critMultiplier = add(new NumberSetting("Crit Multiplier", "Mnożnik cząsteczek krytyków", 1, 1, 5, 1, "x"));

    private final Random random = new Random();

    public Particles() {
        super("Particles", "Kontrola ilości i rodzajów cząsteczek", Category.RENDER);
    }

    /** id is the particle type path, e.g. "crit", "explosion", "smoke". True = drop it. */
    public boolean filter(String id) {
        if (id == null) id = "";
        if (!explosions.isOn() && id.startsWith("explosion")) return true;
        if (!crits.isOn() && "crit".equals(id)) return true;
        if (!enchant.isOn() && ("enchanted_hit".equals(id) || "magic_crit".equals(id))) return true;
        if (!potions.isOn() && ("entity_effect".equals(id) || "effect".equals(id) || "instant_effect".equals(id) || "mob_spell".equals(id) || "spell".equals(id))) return true;
        if (!smoke.isOn() && ("smoke".equals(id) || "large_smoke".equals(id) || "campfire_cosy_smoke".equals(id) || "cloud".equals(id))) return true;
        if (!weather.isOn() && ("rain".equals(id) || "splash".equals(id) || "water_drop".equals(id))) return true;
        if (!totem.isOn() && "totem_of_undying".equals(id)) return true;
        return amount.get() < 100 && random.nextDouble() * 100 >= amount.get();
    }

    @Override
    protected boolean needsHook() { return true; }
}
