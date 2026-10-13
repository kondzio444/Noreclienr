package dev.noreclient.gui.hud;

import dev.noreclient.api.Game;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Platform;
import dev.noreclient.module.HudModule;
import dev.noreclient.module.ModuleManager;
import dev.noreclient.module.client.ClientSettings;

/** Renders all enabled HUD modules at their configured position and scale. */
public class HudRenderer {
    private final ModuleManager modules;

    public HudRenderer(ModuleManager modules) {
        this.modules = modules;
    }

    public void render(Gfx g, float tickDelta) {
        Game game = Platform.game();
        if (game.hudHidden() || game.debugScreen()) return;
        if (HudEditorScreen.isOpen()) return;
        if (game.chatOpen() && !modules.get(ClientSettings.class).hudInChat.isOn()) return;
        int sw = g.width(), sh = g.height();
        for (HudModule h : modules.getHudModules()) {
            if (!h.isEnabled() || !h.shouldRender()) continue;
            renderModule(g, h, sw, sh, tickDelta, false);
        }
    }

    public static void renderModule(Gfx g, HudModule h, int sw, int sh, float tickDelta, boolean editor) {
        float s = h.scale.floatValue();
        g.push();
        g.translate(h.getX(sw), h.getY(sh));
        g.scale(s, s);
        h.render(g, tickDelta, editor);
        g.pop();
    }
}
