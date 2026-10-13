package dev.noreclient.module.client;

import dev.noreclient.gui.click.ClickGuiScreen;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;
import org.lwjgl.glfw.GLFW;

/** Opens the client menu. Bind it to any key (default Right Shift). */
public class ClickGuiModule extends Module {
    public final NumberSetting guiScale = add(new NumberSetting("Menu Scale", "Skala menu klienta", 1.0, 0.6, 1.5, 0.05, "x"));
    public final BooleanSetting openAnimation = add(new BooleanSetting("Open Animation", "Animacja otwierania menu", true));
    public final BooleanSetting showDescriptions = add(new BooleanSetting("Descriptions", "Pokazuj opisy na kartach", true));

    public ClickGuiModule() {
        super("Click GUI", "Menu klienta z wszystkimi modułami", Category.CLIENT, GLFW.GLFW_KEY_RIGHT_SHIFT);
    }

    @Override
    protected void onEnable() {
        // open on the next frame so the same key press doesn't reach (and close) the new screen
        mc.send(() -> {
            if (mc.currentScreen == null) mc.setScreen(new ClickGuiScreen(null));
        });
        setEnabled(false);
    }

    @Override
    protected boolean showsToggleNotification() { return false; }

    @Override
    public boolean isToggleable() { return false; }

    @Override
    public boolean persistsEnabled() { return false; }
}
