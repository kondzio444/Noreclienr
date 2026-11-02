package dev.noreclient.mixin;

import dev.noreclient.platform.GfxImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Client overlays on vanilla screens that do not draw themselves (Auto Reconnect on the "disconnected" screen). */
@Mixin(net.minecraft.client.gui.screen.Screen.class)
public abstract class ScreenOverlayMixin {
    @Inject(method = "render", at = @At("TAIL"))
    private void noreclient$overlay(net.minecraft.client.gui.DrawContext context, int mouseX, int mouseY, float delta, CallbackInfo ci) {
        if (!((Object) this instanceof net.minecraft.client.gui.screen.DisconnectedScreen)) return;
        GfxImpl g = new GfxImpl(context);
        dev.noreclient.module.Hooks.renderDisconnected(g, context.getScaledWindowWidth(), context.getScaledWindowHeight());
        g.finish();
    }
}
