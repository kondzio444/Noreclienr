package dev.noreclient.mixin.skin;

import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractSliderButton;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.resources.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(AbstractSliderButton.class)
public abstract class SliderWidgetMixin {
    @Shadow
    protected double value;

    @Redirect(method = "renderWidget", at = @At(value = "INVOKE", ordinal = 0,
            target = "Lnet/minecraft/client/gui/GuiGraphics;blitSprite(Lcom/mojang/blaze3d/pipeline/RenderPipeline;Lnet/minecraft/resources/Identifier;IIIII)V"))
    private void noreclient$track(GuiGraphics context, com.mojang.blaze3d.pipeline.RenderPipeline pipeline, Identifier texture, int x, int y, int w, int h, int color) {
        AbstractWidget self = (AbstractWidget) (Object) this;
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.sliderTrack(g, self, x, y, w, h, value, self.isHoveredOrFocused(), self.active);
        g.finish();
    }

    @Redirect(method = "renderWidget", at = @At(value = "INVOKE", ordinal = 1,
            target = "Lnet/minecraft/client/gui/GuiGraphics;blitSprite(Lcom/mojang/blaze3d/pipeline/RenderPipeline;Lnet/minecraft/resources/Identifier;IIIII)V"))
    private void noreclient$handle(GuiGraphics context, com.mojang.blaze3d.pipeline.RenderPipeline pipeline, Identifier texture, int x, int y, int w, int h, int color) {
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.sliderHandle(g, x, y, w, h, ((AbstractWidget) (Object) this).active);
        g.finish();
    }
}
