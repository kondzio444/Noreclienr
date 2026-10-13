package dev.noreclient.module.client;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;

/** Always-on module holding the theme and global client options. */
public class ClientSettings extends Module {
    public final ModeSetting preset = add(new ModeSetting("Theme Preset", "Gotowy zestaw kolorów (Custom = własne)", "Nore Orange",
            "Nore Orange", "Crimson", "Violet", "Ocean", "Emerald", "Sakura", "Gold", "Ice", "Custom"));
    public final ModeSetting accentMode = add(new ModeSetting("Accent Mode", "Sposób kolorowania akcentu", "Gradient", "Static", "Gradient", "Wave", "Rainbow"));
    public final ColorSetting accent = add(new ColorSetting("Accent", "Główny kolor akcentu", 0xFFFF8A1F));
    public final ColorSetting accent2 = add(new ColorSetting("Accent 2", "Drugi kolor gradientu", 0xFFFFB547));
    public final NumberSetting cornerRadius = add(new NumberSetting("Corner Radius", "Zaokrąglenie rogów GUI", 6, 0, 12, 1, "px"));
    public final ModeSetting menuBackground = add(new ModeSetting("Menu Background", "Tło menu głównego i ekranów Nore", "Panorama", "Panorama", "Mgławica", "Panorama + gwiazdy"));
    public final BooleanSetting welcomeGuide = add(new BooleanSetting("Welcome Guide", "Pokaż poradnik powitalny przy następnym otwarciu menu", true));
    public final BooleanSetting blur = add(new BooleanSetting("Background Blur", "Rozmycie tła w menu", true));
    public final BooleanSetting notifications = add(new BooleanSetting("Notifications", "Powiadomienia przy przełączaniu modułów", true));
    public final ModeSetting notificationSide = add(new ModeSetting("Notification Side", "Gdzie pokazywać powiadomienia", "Bottom Right", "Bottom Right", "Top Right", "Top Left"));
    public final BooleanSetting sounds = add(new BooleanSetting("GUI Sounds", "Dźwięki kliknięć w GUI", true));
    public final BooleanSetting hudInChat = add(new BooleanSetting("HUD In Chat", "Pokazuj HUD gdy czat jest otwarty", true));

    public ClientSettings() {
        super("Client Settings", "Motyw, kolory i globalne opcje klienta", Category.CLIENT);
        setEnabled(true);
    }

    private static final String[] PRESETS = {"Nore Orange", "Crimson", "Violet", "Ocean", "Emerald", "Sakura", "Gold", "Ice"};
    private static final int[][] COLORS = {
            {0xFFFF8A1F, 0xFFFFB547}, {0xFFFF3B4E, 0xFFFF8A65}, {0xFF9B5CFF, 0xFFD58CFF}, {0xFF2E8BFF, 0xFF4FE3FF},
            {0xFF10C978, 0xFF8BF56A}, {0xFFFF5FA2, 0xFFFFB0D0}, {0xFFE8B300, 0xFFFFE27A}, {0xFF7FD7FF, 0xFFE0F7FF}};
    private String appliedPreset;

    /** Applies the colours of the chosen preset when it changes (Custom keeps the colour pickers). */
    @Override
    public void onTick() {
        String p = preset.get();
        if (appliedPreset == null) {
            appliedPreset = p;
            return;
        }
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
