package dev.noreclient.module.render;

import dev.noreclient.NoreClient;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import net.minecraft.client.option.Perspective;
import net.minecraft.util.math.MathHelper;

/** Look around your character without changing where you are facing (default: Left Alt). */
public class Freelook extends Module {
    public final ModeSetting mode = add(new ModeSetting("Mode", "Przytrzymaj albo przełącz", "Hold", "Hold", "Toggle"));
    public final BooleanSetting invertPitch = add(new BooleanSetting("Invert Pitch", "Odwróć oś pionową", false));

    private boolean active;
    private boolean toggled;
    private boolean keyWasDown;
    private float yaw, pitch;
    private Perspective previous;

    public Freelook() {
        super("Freelook", "Rozglądanie się wokół postaci (domyślnie Left Alt)", Category.RENDER);
        setEnabled(true);
    }

    @Override
    public void onTick() {
        if (mc.player == null) return;
        boolean down = NoreClient.freelookKey != null && NoreClient.freelookKey.isPressed() && mc.currentScreen == null;
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
        yaw = mc.player.getYaw();
        pitch = mc.player.getPitch();
        previous = mc.options.getPerspective();
        if (previous == Perspective.FIRST_PERSON) mc.options.setPerspective(Perspective.THIRD_PERSON_BACK);
    }

    private void stop() {
        active = false;
        toggled = false;
        if (previous != null) mc.options.setPerspective(previous);
    }

    @Override
    protected void onDisable() {
        if (active) stop();
    }

    public boolean isActive() { return active && isEnabled(); }

    public void addRotation(double dx, double dy) {
        yaw += (float) (dx * 0.15);
        pitch = MathHelper.clamp(pitch + (float) (dy * 0.15 * (invertPitch.isOn() ? -1 : 1)), -90f, 90f);
    }

    public float getYaw() { return yaw; }
    public float getPitch() { return pitch; }
}
