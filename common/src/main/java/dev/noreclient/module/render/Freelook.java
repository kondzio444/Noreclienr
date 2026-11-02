package dev.noreclient.module.render;

import dev.noreclient.api.Keys;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.util.KeyState;

/** Look around your character without changing where you are facing (default: Left Alt). */
public class Freelook extends Module {
    public final KeybindSetting freelookKey = add(new KeybindSetting("Freelook Key", "Klawisz rozglądania się", Keys.LEFT_ALT));
    public final ModeSetting mode = add(new ModeSetting("Mode", "Przytrzymaj albo przełącz", "Hold", "Hold", "Toggle"));
    public final BooleanSetting invertPitch = add(new BooleanSetting("Invert Pitch", "Odwróć oś pionową", false));

    private boolean active, toggled, keyWasDown;
    private float yaw, pitch;
    private int previous = -1;

    public Freelook() {
        super("Freelook", "Rozglądanie się wokół postaci (domyślnie Left Alt)", Category.RENDER);
        setEnabled(true);
    }

    @Override
    public void onTick() {
        if (!inGame()) return;
        boolean down = KeyState.down(freelookKey.get()) && !game().screenOpen();
        boolean want;
        if (mode.is("Toggle")) {
            if (down && !keyWasDown) toggled = !toggled;
            want = toggled;
        } else {
            want = down;
        }
        keyWasDown = down;
        if (want && !active) start();
        else if (!want && active) stop();
    }

    private void start() {
        active = true;
        yaw = game().yaw(1);
        pitch = game().pitch();
        previous = game().perspective();
        if (previous == 0) game().setPerspective(1);
    }

    private void stop() {
        active = false;
        toggled = false;
        if (previous >= 0) game().setPerspective(previous);
    }

    @Override
    protected void onDisable() {
        if (active) stop();
    }

    public boolean isLooking() { return active && isActive(); }

    public void addRotation(double dx, double dy) {
        yaw += (float) (dx * 0.15);
        pitch = Math.max(-90f, Math.min(90f, pitch + (float) (dy * 0.15 * (invertPitch.isOn() ? -1 : 1))));
    }

    public float getYaw() { return yaw; }

    public float getPitch() { return pitch; }

    @Override
    protected boolean needsHook() { return true; }
}
