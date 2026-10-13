package dev.noreclient.module;

import dev.noreclient.api.Gfx;

import dev.noreclient.api.Game;
import dev.noreclient.api.Keys;
import dev.noreclient.api.Platform;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.setting.Setting;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public abstract class Module {
    private final String name;
    private final String description;
    private final Category category;
    private final List<Setting<?>> settings = new ArrayList<Setting<?>>();
    private final KeybindSetting keybind;
    private boolean enabled;
    private boolean favorite;

    protected Module(String name, String description, Category category) {
        this(name, description, category, Keys.UNKNOWN);
    }

    protected Module(String name, String description, Category category, int defaultKey) {
        this.name = name;
        this.description = description;
        this.category = category;
        this.keybind = new KeybindSetting("Keybind", "Klawisz przełączania modułu", defaultKey);
    }

    protected static Game game() { return Platform.game(); }

    protected <S extends Setting<?>> S add(S setting) {
        settings.add(setting);
        return setting;
    }

    public void toggle() {
        setEnabled(!enabled);
    }

    public void setEnabled(boolean enabled) {
        if (this.enabled == enabled) return;
        this.enabled = enabled;
        if (enabled) onEnable(); else onDisable();
    }

    /** Toggle triggered by the user (keybind / GUI): also shows a notification. */
    public void toggleWithFeedback() {
        toggle();
        if (showsToggleNotification()) {
            NotificationManager.push(name, enabled ? "Włączono" : "Wyłączono",
                    enabled ? NotificationManager.Type.SUCCESS : NotificationManager.Type.ERROR);
        }
    }

    protected boolean showsToggleNotification() { return true; }

    public boolean persistsEnabled() { return true; }

    public boolean isToggleable() { return true; }

    /** Modules that rely on a platform hook (mixin) override this to return true. */
    protected boolean needsHook() { return false; }

    /** Whether the running Minecraft version supports this module. */
    public boolean isSupported() {
        return !needsHook() || Platform.supports(name);
    }

    protected void onEnable() {}

    protected void onDisable() {}

    public void onTick() {}

    /** Any key pressed in game (no screen open); for modules with their own extra keys. */
    public void onKeyPressed(int key) {}

    /** Full-screen effects drawn under the HUD (vignettes, flashes...). */
    public void onRenderOverlay(Gfx g, float tickDelta) {}

    public String getName() { return name; }

    public String getDescription() { return description; }

    public Category getCategory() { return category; }

    public boolean isEnabled() { return enabled; }

    public boolean isFavorite() { return favorite; }

    public void setFavorite(boolean favorite) { this.favorite = favorite; }

    /** Enabled and supported by this version: what hooks should check. */
    public boolean isActive() { return enabled && isSupported(); }

    public List<Setting<?>> getSettings() { return Collections.unmodifiableList(settings); }

    public KeybindSetting getKeybind() { return keybind; }

    public String getSuffix() { return null; }

    protected boolean inGame() {
        return game().inWorld();
    }
}
