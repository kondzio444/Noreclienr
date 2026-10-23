package dev.noreclient.module.client;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.NoreScene;

/** Always-on module holding the theme and global client options. */
public class ClientSettings extends Module {
    public final ModeSetting preset = add(new ModeSetting("Theme Preset", "Gotowy zestaw kolorów (Custom = własne)", "Nore Violet",
            "Nore Violet", "Crimson", "Violet", "Ocean", "Emerald", "Sakura", "Gold", "Ice", "Ember", "Custom"));
    public final ModeSetting accentMode = add(new ModeSetting("Accent Mode", "Sposób kolorowania akcentu", "Gradient", "Static", "Gradient", "Wave", "Rainbow"));
    public final ColorSetting accent = add(new ColorSetting("Accent", "Główny kolor akcentu", 0xFF9D5CFF));
    public final ColorSetting accent2 = add(new ColorSetting("Accent 2", "Drugi kolor gradientu", 0xFFC8A8FF));
    public final NumberSetting cornerRadius = add(new NumberSetting("Corner Radius", "Zaokrąglenie rogów GUI", 6, 0, 12, 1, "px"));
    public final ModeSetting menuBackground = add(new ModeSetting("Menu Background", "Tło menu głównego i ekranów Nore", "Wiśniowy staw", "Wiśniowy staw", "Scena Nore", "Panorama", "Mgławica", "Panorama + gwiazdy"));
    /** One-time switch of older configs to the new "Wiśniowy staw" background (hidden). */
    public final BooleanSetting backgroundMigrated = add(new BooleanSetting("Background Migrated", "", false));
    public final NumberSetting sceneTime = add(new NumberSetting("Scene Time", "Pora dnia w tle menu (minuty po północy)", 600, 0, 1435, 5));
    public final BooleanSetting sceneRealTime = add(new BooleanSetting("Scene Real Time", "Scena Nore pokazuje prawdziwą porę dnia", false));
    public final ModeSetting sceneTree = add(new ModeSetting("Scene Trees", "Drzewa w Scenie Nore", NoreScene.TREES[0], NoreScene.TREES));
    public final ModeSetting sceneCamera = add(new ModeSetting("Scene Camera", "Ujęcie kamery w Scenie Nore", NoreScene.CAMERAS[0], NoreScene.CAMERAS));
    public final BooleanSetting welcomeGuide = add(new BooleanSetting("Welcome Guide", "Pokaż poradnik powitalny przy następnym otwarciu menu", true));
    public final BooleanSetting blur = add(new BooleanSetting("Background Blur", "Rozmycie tła w menu", true));
    public final BooleanSetting notifications = add(new BooleanSetting("Notifications", "Powiadomienia przy przełączaniu modułów", true));
    public final ModeSetting notificationSide = add(new ModeSetting("Notification Side", "Gdzie pokazywać powiadomienia", "Bottom Right", "Bottom Right", "Top Right", "Top Left"));
    public final BooleanSetting sounds = add(new BooleanSetting("GUI Sounds", "Dźwięki kliknięć w GUI", true));
    public final BooleanSetting hudInChat = add(new BooleanSetting("HUD In Chat", "Pokazuj HUD gdy czat jest otwarty", true));

    public ClientSettings() {
        super("Client Settings", "Motyw, kolory i globalne opcje klienta", Category.CLIENT);
        backgroundMigrated.visibleWhen(() -> false);
        setEnabled(true);
    }

    private static final String[] PRESETS = {"Nore Violet", "Crimson", "Violet", "Ocean", "Emerald", "Sakura", "Gold", "Ice", "Ember"};
    private static final int[][] COLORS = {
            {0xFF9D5CFF, 0xFFC8A8FF}, {0xFFFF3B4E, 0xFFFF8A65}, {0xFF9B5CFF, 0xFFD58CFF}, {0xFF2E8BFF, 0xFF4FE3FF},
            {0xFF10C978, 0xFF8BF56A}, {0xFFFF5FA2, 0xFFFFB0D0}, {0xFFE8B300, 0xFFFFE27A}, {0xFF7FD7FF, 0xFFE0F7FF}, {0xFFFF8A1F, 0xFFFFB547}};
    private String appliedPreset;

    /** Time of day shown by the Scena Nore background (minutes after midnight). */
    public float sceneMinutes() { return sceneRealTime.isOn() ? NoreScene.realMinutes() : sceneTime.get().floatValue(); }

    /** Applies the colours of the chosen preset when it changes (Custom keeps the colour pickers). */
    @Override
    public void onTick() {
        if (!backgroundMigrated.isOn()) {
            backgroundMigrated.set(true);
            menuBackground.set("Wiśniowy staw");
            sceneTime.set(600.0);
            if (dev.noreclient.NoreClient.get() != null) dev.noreclient.NoreClient.get().config().save();
        }
        NoreScene.setTree(sceneTree.get());
        NoreScene.setCamera(sceneCamera.getModes().indexOf(sceneCamera.get()));
        String p = preset.get();
        // also on the first tick: a preset always shows its own colours (older configs kept the orange ones)
        if (p.equals(appliedPreset)) return;
        appliedPreset = p;
        for (int i = 0; i < PRESETS.length; i++) {
            if (PRESETS[i].equals(p)) {
                accent.set(COLORS[i][0]);
                accent2.set(COLORS[i][1]);
                accent.setChroma(false);
            }
        }
    }

    /** Colours of a preset, for the swatches in the GUI. */
    public static int[] presetColors(String name) {
        for (int i = 0; i < PRESETS.length; i++) if (PRESETS[i].equals(name)) return COLORS[i];
        return null;
    }

    @Override
    public boolean isToggleable() { return false; }

    @Override
    public boolean persistsEnabled() { return false; }
}
