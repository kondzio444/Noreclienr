package dev.noreclient.mixin.skin;

import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.resources.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** Buttons and cycling buttons: Nore frame instead of the vanilla button texture. */
@Mixin(AbstractButton.class)
public abstract class PressableWidgetMixin {
    @Redirect(method = "renderDefaultSprite", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/client/gui/GuiGraphics;blitSprite(Lcom/mojang/blaze3d/pipeline/RenderPipeline;Lnet/minecraft/resources/Identifier;IIIII)V"))
    private void noreclient$frame(GuiGraphics context, com.mojang.blaze3d.pipeline.RenderPipeline pipeline, Identifier texture, int x, int y, int w, int h, int color) {
        AbstractWidget self = (AbstractWidget) (Object) this;
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.button(g, self, x, y, w, h, self.isHoveredOrFocused(), self.active);
        g.finish();
    }
}
