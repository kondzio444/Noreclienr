package dev.noreclient.module;

import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.setting.Setting;
import net.minecraft.client.MinecraftClient;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public abstract class Module {
    protected static final MinecraftClient mc = MinecraftClient.getInstance();

    private final String name;
    private final String description;
    private final Category category;
    private final List<Setting<?>> settings = new ArrayList<>();
    private final KeybindSetting keybind;
    private boolean enabled;

    protected Module(String name, String description, Category category) {
        this(name, description, category, GLFW.GLFW_KEY_UNKNOWN);
    }

    protected Module(String name, String description, Category category, int defaultKey) {
        this.name = name;
        this.description = description;
        this.category = category;
        this.keybind = new KeybindSetting("Keybind", "Klawisz przełączania modułu", defaultKey);
    }

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

    /** Whether the enabled flag should be stored in configs (false for screen-opening modules). */
    public boolean persistsEnabled() { return true; }

    /** Whether this module can be switched on/off at all (some are always-on settings holders). */
    public boolean isToggleable() { return true; }

    protected void onEnable() {}
    protected void onDisable() {}
    public void onTick() {}

    public String getName() { return name; }
    public String getDescription() { return description; }
    public Category getCategory() { return category; }
    public boolean isEnabled() { return enabled; }
    public List<Setting<?>> getSettings() { return Collections.unmodifiableList(settings); }
    public KeybindSetting getKeybind() { return keybind; }

    /** Extra info shown next to the module name in the module list HUD. */
    public String getSuffix() { return null; }

    protected boolean inGame() {
        return mc.player != null && mc.world != null;
    }
}
