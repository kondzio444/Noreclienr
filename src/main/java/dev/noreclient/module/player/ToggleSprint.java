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
        if (mc.player == null) return;
        boolean moving = !onlyForward.isOn() || mc.options.forwardKey.isPressed();
        if (moving && !mc.player.isSneaking() && !mc.player.horizontalCollision) mc.options.sprintKey.setPressed(true);
    }

    @Override
    protected void onDisable() {
        mc.options.sprintKey.setPressed(false);
    }

    @Override
    public String getSuffix() { return "Toggled"; }
}
