package dev.noreclient.module.hud;

import dev.noreclient.setting.ModeSetting;

public class SpeedHud extends TextHudModule {
    public final ModeSetting unit = add(new ModeSetting("Unit", "Jednostka prędkości", "b/s", "b/s", "km/h"));

    public SpeedHud() {
        super("Speed", "Aktualna prędkość poruszania się", 0.0f, 0.33f);
    }

    @Override protected String label() { return "Speed"; }

    @Override
    protected String value() {
        if (mc.player == null) return "0.00 " + unit.get();
        double dx = mc.player.getX() - mc.player.prevX;
        double dz = mc.player.getZ() - mc.player.prevZ;
        double bps = Math.sqrt(dx * dx + dz * dz) * 20.0;
        if (unit.is("km/h")) return String.format("%.1f km/h", bps * 3.6);
        return String.format("%.2f b/s", bps);
    }
}
