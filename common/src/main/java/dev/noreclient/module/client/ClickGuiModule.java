package dev.noreclient.module.client;

import dev.noreclient.api.Keys;
import dev.noreclient.gui.click.ClickGuiScreen;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.setting.NumberSetting;

/** Opens the client menu. Bind it to any key (default Right Shift). */
public class ClickGuiModule extends Module {
    public final NumberSetting guiScale = add(new NumberSetting("Menu Scale", "Skala menu klienta", 1.0, 0.6, 1.5, 0.05, "x"));
    public final BooleanSetting openAnimation = add(new BooleanSetting("Open Animation", "Animacja otwierania menu", true));
    public final BooleanSetting showDescriptions = add(new BooleanSetting("Descriptions", "Pokazuj opisy na kartach", true));
    public final KeybindSetting hudEditorKey = add(new KeybindSetting("HUD Editor Key", "Klawisz edytora HUD", Keys.H));

    public ClickGuiModule() {
        super("Click GUI", "Menu klienta z wszystkimi modułami", Category.CLIENT, Keys.RIGHT_SHIFT);
    }

    @Override
    protected void onEnable() {
        setEnabled(false);
        if (!game().screenOpen()) game().openScreen(new ClickGuiScreen(null));
    }

    @Override
    protected boolean showsToggleNotification() { return false; }

    @Override
    public boolean persistsEnabled() { return false; }

    @Override
    public boolean isToggleable() { return false; }
}
