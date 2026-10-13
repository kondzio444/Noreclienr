package dev.noreclient.module.client;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;

/** Always-on module holding the theme and global client options. */
public class ClientSettings extends Module {
    public final ModeSetting accentMode = add(new ModeSetting("Accent Mode", "Sposób kolorowania akcentu", "Gradient", "Static", "Gradient", "Wave", "Rainbow"));
    public final ColorSetting accent = add(new ColorSetting("Accent", "Główny kolor akcentu", 0xFF8B5CF6));
    public final ColorSetting accent2 = add(new ColorSetting("Accent 2", "Drugi kolor gradientu", 0xFF22D3EE));
    public final NumberSetting cornerRadius = add(new NumberSetting("Corner Radius", "Zaokrąglenie rogów GUI", 6, 0, 12, 1, "px"));
    public final BooleanSetting blur = add(new BooleanSetting("Background Blur", "Rozmycie tła w menu", true));
    public final BooleanSetting customMenu = add(new BooleanSetting("Custom Main Menu", "Własne menu główne klienta", true));
    public final BooleanSetting customPause = add(new BooleanSetting("Custom Pause Menu", "Własne menu pauzy klienta", true));
    public final BooleanSetting notifications = add(new BooleanSetting("Notifications", "Powiadomienia przy przełączaniu modułów", true));
    public final ModeSetting notificationSide = add(new ModeSetting("Notification Side", "Gdzie pokazywać powiadomienia", "Bottom Right", "Bottom Right", "Top Right", "Top Left"));
    public final BooleanSetting sounds = add(new BooleanSetting("GUI Sounds", "Dźwięki kliknięć w GUI", true));
    public final BooleanSetting hudInChat = add(new BooleanSetting("HUD In Chat", "Pokazuj HUD gdy czat jest otwarty", true));

    public ClientSettings() {
        super("Client Settings", "Motyw, kolory i globalne opcje klienta", Category.CLIENT);
        setEnabled(true);
    }

    @Override
    public boolean isToggleable() { return false; }

    @Override
    public boolean persistsEnabled() { return false; }
}
