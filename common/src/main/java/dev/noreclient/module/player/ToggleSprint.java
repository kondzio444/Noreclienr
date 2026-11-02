package dev.noreclient.module.player;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;

/** Keeps sprint held so you never have to double-tap W or hold Ctrl. */
public class ToggleSprint extends Module {
    public final BooleanSetting onlyForward = add(new BooleanSetting("Only Forward", "Sprint tylko przy ruchu do przodu", true));

    public ToggleSprint() {
        super("Toggle Sprint", "Automatyczny, stały sprint", Category.PLAYER);
    }

    @Override
    public void onTick() {
        if (!inGame()) return;
        boolean moving = !onlyForward.isOn() || game().keyDown("forward");
        if (moving && !game().sneaking() && !game().horizontalCollision()) game().setSprintHeld(true);
    }

    @Override
    protected void onDisable() {
        if (inGame()) game().setSprintHeld(false);
    }

    @Override
    public String getSuffix() { return "Toggled"; }
}
