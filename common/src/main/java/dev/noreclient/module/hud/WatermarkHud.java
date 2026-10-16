package dev.noreclient.module.hud;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

public class WatermarkHud extends HudModule {
    public final ModeSetting style = add(new ModeSetting("Style", "Wygląd znaku wodnego", "Pill", "Pill", "Text", "Glow"));
    public final BooleanSetting showVersion = add(new BooleanSetting("Version", "Pokazuj wersję", true));
    public final BooleanSetting showFps = add(new BooleanSetting("FPS", "Pokazuj FPS", true));
    public final BooleanSetting showName = add(new BooleanSetting("Username", "Pokazuj nick", false));
    public final BooleanSetting showMc = add(new BooleanSetting("Minecraft Version", "Pokazuj wersję Minecraft", false));

    public WatermarkHud() {
        super("Watermark", "Logo klienta w rogu ekranu", 0.0f, 0.0f);
        setEnabled(true);
    }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        String logo = "Nore";
        StringBuilder info = new StringBuilder();
        if (showVersion.isOn()) info.append("v").append(NoreClient.VERSION);
        if (showMc.isOn()) info.append(info.length() > 0 ? "  •  " : "").append(game().minecraftVersion());
        if (showFps.isOn()) info.append(info.length() > 0 ? "  •  " : "").append(game().fps()).append(" fps");
        if (showName.isOn()) info.append(info.length() > 0 ? "  •  " : "").append(game().username());
        int logoW = Render2D.textWidth(logo);
        int infoW = info.length() > 0 ? Render2D.textWidth(info.toString()) : 0;
        if (style.is("Text")) {
            width = logoW * 1.5f + (infoW > 0 ? infoW + 6 : 0);
            height = 14;
            Render2D.gradientText(g, logo, 0, 1, 1.5f, Theme.accent(), Theme.accent2(), true);
            if (infoW > 0) Render2D.text(g, info.toString(), logoW * 1.5f + 6, 4, 0xFFDDDDEE, true);
            return;
        }
        width = 10 + logoW + (infoW > 0 ? 10 + infoW : 0) + 8;
        height = 18;
        float r = Theme.radius();
        if (style.is("Glow")) Render2D.shadow(g, 0, 0, width, height, r, 6, ColorUtil.withAlpha(Theme.accent(), 120));
        Render2D.roundedRect(g, 0, 0, width, height, r, 0xD0160F26);
        Render2D.roundedGradient(g, 0, 0, 4 + logoW + 8, height, r, Theme.accent(), Theme.accent2(), false);
        Render2D.text(g, logo, 6, 5, 0xFFFFFFFF, true);
        if (infoW > 0) Render2D.text(g, info.toString(), 4 + logoW + 8 + 6, 5, 0xFFE6E6F0, false);
    }
}
