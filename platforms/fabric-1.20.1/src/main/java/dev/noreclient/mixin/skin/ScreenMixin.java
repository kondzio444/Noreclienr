package dev.noreclient.mixin.skin;

import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Menus outside a world show the Nore backdrop instead of the dirt texture (1.20.2–1.20.4 have no menu blur/darkening). */
@Mixin(Screen.class)
public abstract class ScreenMixin {
    @Shadow
    public int width;
    @Shadow
    public int height;

    @Inject(method = "renderBackgroundTexture", at = @At("HEAD"), cancellable = true)
    private void noreclient$background(DrawContext context, CallbackInfo ci) {
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.menuBackground(g, width, height);
        g.finish();
        ci.cancel();
    }
}
