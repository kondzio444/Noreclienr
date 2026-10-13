package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;
import net.minecraft.particle.ParticleEffect;
import net.minecraft.particle.ParticleType;
import net.minecraft.particle.ParticleTypes;

import java.util.concurrent.ThreadLocalRandom;

/** Reduce or hide particle types for clarity and FPS. */
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

    public Particles() {
        super("Particles", "Kontrola ilości i rodzajów cząsteczek", Category.RENDER);
    }

    /** True when this particle should be dropped. */
    public boolean filter(ParticleEffect effect) {
        ParticleType<?> t = effect.getType();
        if (!explosions.isOn() && (t == ParticleTypes.EXPLOSION || t == ParticleTypes.EXPLOSION_EMITTER)) return true;
        if (!crits.isOn() && t == ParticleTypes.CRIT) return true;
        if (!enchant.isOn() && t == ParticleTypes.ENCHANTED_HIT) return true;
        if (!potions.isOn() && (t == ParticleTypes.ENTITY_EFFECT || t == ParticleTypes.EFFECT || t == ParticleTypes.INSTANT_EFFECT)) return true;
        if (!smoke.isOn() && (t == ParticleTypes.SMOKE || t == ParticleTypes.LARGE_SMOKE || t == ParticleTypes.CAMPFIRE_COSY_SMOKE || t == ParticleTypes.CLOUD)) return true;
        if (!weather.isOn() && (t == ParticleTypes.RAIN || t == ParticleTypes.SPLASH)) return true;
        if (!totem.isOn() && t == ParticleTypes.TOTEM_OF_UNDYING) return true;
        return amount.get() < 100 && ThreadLocalRandom.current().nextDouble() * 100 >= amount.get();
    }
}
