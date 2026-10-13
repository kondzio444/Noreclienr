package dev.noreclient.module.hud;

import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.util.ClickTracker;

public class CpsHud extends TextHudModule {
    public final BooleanSetting showRight = add(new BooleanSetting("Right Click", "Pokazuj także prawy przycisk", true));

    public CpsHud() {
        super("CPS", "Kliknięcia na sekundę (LPM | PPM)", 0.0f, 0.19f);
    }

    @Override protected String label() { return "CPS"; }

    @Override
    protected String value() {
        return showRight.isOn() ? ClickTracker.left() + " | " + ClickTracker.right() : String.valueOf(ClickTracker.left());
    }
}
