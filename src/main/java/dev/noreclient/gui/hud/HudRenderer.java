package dev.noreclient.gui.hud;

import dev.noreclient.module.HudModule;
import dev.noreclient.module.ModuleManager;
import dev.noreclient.module.client.ClientSettings;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.ChatScreen;

/** Renders all enabled HUD modules at their configured position and scale. */
public class HudRenderer {
    private final ModuleManager modules;

    public HudRenderer(ModuleManager modules) {
        this.modules = modules;
    }

    public void render(DrawContext ctx, float tickDelta) {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.options.hudHidden || mc.getDebugHud().shouldShowDebugHud()) return;
        if (mc.currentScreen instanceof HudEditorScreen) return;
        if (mc.currentScreen instanceof ChatScreen && !modules.get(ClientSettings.class).hudInChat.isOn()) return;
        int sw = ctx.getScaledWindowWidth(), sh = ctx.getScaledWindowHeight();
        for (HudModule h : modules.getHudModules()) {
            if (!h.isEnabled() || !h.shouldRender()) continue;
            renderModule(ctx, h, sw, sh, tickDelta, false);
        }
    }

    public static void renderModule(DrawContext ctx, HudModule h, int sw, int sh, float tickDelta, boolean editor) {
        float s = h.scale.floatValue();
        ctx.getMatrices().push();
        ctx.getMatrices().translate(h.getX(sw), h.getY(sh), 0);
        ctx.getMatrices().scale(s, s, 1);
        h.render(ctx, tickDelta, editor);
        ctx.getMatrices().pop();
    }
}
