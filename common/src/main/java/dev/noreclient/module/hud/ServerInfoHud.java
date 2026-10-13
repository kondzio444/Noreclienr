package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.ServerInfo;
import dev.noreclient.util.Theme;

/** Current server: icon, address, country flag, players and ping. */
public class ServerInfoHud extends HudModule {
    public final BooleanSetting showMotd = add(new BooleanSetting("Show MOTD", "Opis serwera pod adresem", false));
    public final BooleanSetting showCountry = add(new BooleanSetting("Show Country", "Kraj serwera obok flagi", true));
    public final BooleanSetting background = add(new BooleanSetting("Background", "Tło", true));

    public ServerInfoHud() {
        super("Server Info", "Flaga, gracze i ping serwera, na którym grasz", 1.0f, 0.12f);
    }

    @Override
    public boolean shouldRender() { return !game().singleplayer() && game().serverAddress() != null; }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        String addr = game().serverAddress();
        ServerInfo.Info info = addr == null ? null : ServerInfo.get(addr);
        String name = addr == null ? "mc.example.net" : addr;
        String players = info != null && info.online >= 0 ? info.online + "/" + info.max + " graczy" : editor ? "37/200 graczy" : "...";
        String country = showCountry.isOn() && info != null && info.country != null ? info.country : editor && showCountry.isOn() ? "Polska" : null;
        width = Math.max(110, Math.max(Render2D.textWidth(name), Render2D.textWidth(players) + (country != null ? Render2D.textWidth(country) * 0.7f + 22 : 0)) + 36);
        height = showMotd.isOn() ? 40 : 28;
        if (background.isOn()) {
            Render2D.roundedRect(g, 0, 0, width, height, Theme.radius() * 0.8f, 0x90140F0C);
            Render2D.roundedOutline(g, 0, 0, width, height, Theme.radius() * 0.8f, 1, ColorUtil.withAlpha(Theme.accent(), 70));
        }
        if (info != null && info.favicon != null) Render2D.texture(g, info.favicon, 4, 4, 20, 20, 1f);
        else Render2D.roundedRect(g, 4, 4, 20, 20, 3, ColorUtil.withAlpha(Theme.accent(), 80));
        Render2D.text(g, Render2D.trim(name, (int) width - 34), 28, 5, Theme.TEXT, true);
        ServerInfo.drawFlag(g, info, 28, 16, 6);
        Render2D.scaledText(g, players, 39, 16.5f, 0.7f, Theme.TEXT_DIM, true);
        if (country != null) Render2D.scaledText(g, country, 41 + Render2D.textWidth(players) * 0.7f, 16.5f, 0.7f, Theme.TEXT_MUTED, true);
        long ping = info != null && info.ping >= 0 ? game().ping() : editor ? 42 : -1;
        ServerInfo.drawBars(g, ping, width - 16, 4, 8);
        if (showMotd.isOn() && info != null) {
            String line = info.motd.split("\\n")[0].trim();
            Render2D.scaledText(g, Render2D.trim(line, (int) ((width - 8) / 0.65f)), 4, 30, 0.65f, 0xFFDDDDDD, true);
        }
    }
}
