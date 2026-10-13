package dev.noreclient.module.hud;

import dev.noreclient.setting.NumberSetting;
import net.minecraft.entity.Entity;

/** Counts consecutive hits that landed without being hit back. */
public class ComboHud extends TextHudModule {
    public final NumberSetting resetTime = add(new NumberSetting("Reset Time", "Po ilu sekundach zerować combo", 3, 1, 10, 0.5, "s"));

    private int combo;
    private long lastHit;
    private int lastHurtTime;

    public ComboHud() {
        super("Combo", "Licznik combo w walce", 0.5f, 0.75f);
    }

    public void onHit(Entity target) {
        combo++;
        lastHit = System.currentTimeMillis();
    }

    @Override
    public void onTick() {
        if (mc.player == null) return;
        if (mc.player.hurtTime > 0 && lastHurtTime == 0) combo = 0;
        lastHurtTime = mc.player.hurtTime;
        if (System.currentTimeMillis() - lastHit > resetTime.get() * 1000) combo = 0;
    }

    @Override protected String label() { return "Combo"; }
    @Override protected String value() { return String.valueOf(combo); }
}
