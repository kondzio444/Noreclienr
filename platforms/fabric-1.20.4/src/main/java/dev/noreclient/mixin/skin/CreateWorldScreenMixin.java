package dev.noreclient.mixin.skin;

import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.world.CreateWorldScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** 1.20.2–1.20.4: the world creation screen overrides the background with light dirt; use the Nore backdrop. */
@Mixin(CreateWorldScreen.class)
public abstract class CreateWorldScreenMixin {
    @Inject(method = "renderBackgroundTexture", at = @At("HEAD"), cancellable = true)
    private void noreclient$background(DrawContext context, CallbackInfo ci) {
        Screen self = (Screen) (Object) this;
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.menuBackground(g, self.width, self.height);
        g.finish();
        ci.cancel();
    }
}
