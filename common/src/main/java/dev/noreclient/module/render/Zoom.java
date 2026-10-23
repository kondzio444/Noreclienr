package dev.noreclient.module.render;

import dev.noreclient.api.Keys;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.Animation;
import dev.noreclient.util.KeyState;

/** OptiFine-style zoom: hold the zoom key (default C), scroll to change the factor. */
public class Zoom extends Module {
    public final KeybindSetting zoomKey = add(new KeybindSetting("Zoom Key", "Klawisz przybliżenia (przytrzymaj)", Keys.C));
    public final NumberSetting factor = add(new NumberSetting("Zoom Factor", "Domyślne przybliżenie", 4, 1.5, 50, 0.5, "x"));
    public final BooleanSetting smooth = add(new BooleanSetting("Smooth", "Płynna animacja przybliżenia", true));
    public final BooleanSetting scroll = add(new BooleanSetting("Scroll Adjust", "Zmiana przybliżenia kółkiem myszy", true));
    public final BooleanSetting cinematic = add(new BooleanSetting("Cinematic Camera", "Płynna kamera podczas zoomu", false));
    public final BooleanSetting reduceSensitivity = add(new BooleanSetting("Reduce Sensitivity", "Mniejsza czułość myszy podczas zoomu", true));

    private final Animation anim = new Animation(1, 14);
    private double scrollFactor = -1;
    private boolean wasZooming, prevCinematic;

    public Zoom() {
        super("Zoom", "Przybliżenie widoku pod klawiszem (domyślnie C)", Category.RENDER);
        setEnabled(true);
    }

    public boolean isZooming() {
        return isActive() && KeyState.down(zoomKey.get()) && !game().screenOpen();
    }

    @Override
    public void onTick() {
        boolean zooming = isZooming();
        if (zooming && !wasZooming) {
            scrollFactor = factor.get();
            if (cinematic.isOn()) {
                prevCinematic = game().smoothCamera();
                game().setSmoothCamera(true);
            }
        } else if (!zooming && wasZooming && cinematic.isOn()) {
            game().setSmoothCamera(prevCinematic);
        }
        wasZooming = zooming;
    }

    public boolean onScroll(double amount) {
        if (!isZooming() || !scroll.isOn()) return false;
        scrollFactor = Math.max(1.0, Math.min(50.0, scrollFactor * (amount > 0 ? 1.15 : 1 / 1.15)));
        return true;
    }

    public double getCurrentDivisor() {
        double target = isZooming() ? (scrollFactor > 0 ? scrollFactor : factor.get()) : 1;
        if (!smooth.isOn()) {
            anim.set((float) target);
            return target;
        }
        anim.target((float) target);
        return anim.update();
    }

    public double sensitivityMultiplier() {
        if (!isZooming() || !reduceSensitivity.isOn()) return 1;
        return 1.0 / Math.max(1, anim.get());
    }

    @Override
    public String getSuffix() { return factor.format(); }

    @Override
    protected boolean needsHook() { return true; }
}
