package dev.noreclient.mixin.skin;

import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Menus outside a world show the Nore backdrop instead of the panorama. */
@Mixin(Screen.class)
public abstract class ScreenMixin {
    @Shadow
    public int width;

    @Shadow
    public int height;

    @Inject(method = "extractPanorama", at = @At("HEAD"), cancellable = true)
    private void noreclient$background(GuiGraphicsExtractor context, float delta, CallbackInfo ci) {
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.menuBackground(g, width, height);
        g.finish();
        ci.cancel();
    }

    @Inject(method = "extractMenuBackground(Lnet/minecraft/client/gui/GuiGraphicsExtractor;IIII)V", at = @At("HEAD"), cancellable = true)
    private void noreclient$darkening(GuiGraphicsExtractor context, int x, int y, int w, int h, CallbackInfo ci) {
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.darkening(g, x, y, w, h);
        g.finish();
        ci.cancel();
    }
}
