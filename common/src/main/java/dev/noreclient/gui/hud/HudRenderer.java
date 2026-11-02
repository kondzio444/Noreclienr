package dev.noreclient.gui.hud;

import dev.noreclient.api.Game;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Platform;
import dev.noreclient.module.HudModule;
import dev.noreclient.module.ModuleManager;
import dev.noreclient.module.client.ClientSettings;
import dev.noreclient.util.Animation;

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
            Animation a = fades.get(h);
            if (!h.isEnabled() && (a == null || a.get() < 0.01f)) continue;
            boolean data = h.shouldRender();
            if (a == null) fades.put(h, a = new Animation(0, 12));
            float f = a.target(h.isEnabled() && data ? 1 : 0).update();
            // elements without anything to show disappear at once (their content would be a preview)
            if (f < 0.01f || !data) { if (!data) a.set(0); continue; }
            if (f >= 0.999f) { renderModule(g, h, sw, sh, tickDelta, false); continue; }
            // fade and settle in when switched on or when content appears, fade out when switched off
            float e = Animation.easeOutCubic(f);
            float prev = g.getAlpha();
            g.setAlpha(prev * e);
            g.push();
            g.translate(0, (1 - e) * (h.getRelY() > 0.5f ? 4 : -4));
            renderModule(g, h, sw, sh, tickDelta, false);
            g.pop();
            g.setAlpha(prev);
        }
    }

    private final java.util.Map<HudModule, Animation> fades = new java.util.IdentityHashMap<HudModule, Animation>();

    public static void renderModule(Gfx g, HudModule h, int sw, int sh, float tickDelta, boolean editor) {
        float s = h.scale.floatValue();
        g.push();
        g.translate(h.getX(sw), h.getY(sh));
        g.scale(s, s);
        h.render(g, tickDelta, editor);
        g.pop();
    }
}
