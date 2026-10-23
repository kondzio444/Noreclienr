package dev.noreclient.mixin.skin;

import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.SliderWidget;
import net.minecraft.util.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(SliderWidget.class)
public abstract class SliderWidgetMixin {
    @Shadow
    protected double value;

    @Redirect(method = "renderWidget", at = @At(value = "INVOKE", ordinal = 0,
            target = "Lnet/minecraft/client/gui/DrawContext;drawGuiTexture(Lcom/mojang/blaze3d/pipeline/RenderPipeline;Lnet/minecraft/util/Identifier;IIIII)V"))
    private void noreclient$track(DrawContext context, com.mojang.blaze3d.pipeline.RenderPipeline pipeline, Identifier texture, int x, int y, int w, int h, int color) {
        ClickableWidget self = (ClickableWidget) (Object) this;
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.sliderTrack(g, self, x, y, w, h, value, self.isSelected(), self.active);
        g.finish();
    }

    @Redirect(method = "renderWidget", at = @At(value = "INVOKE", ordinal = 1,
            target = "Lnet/minecraft/client/gui/DrawContext;drawGuiTexture(Lcom/mojang/blaze3d/pipeline/RenderPipeline;Lnet/minecraft/util/Identifier;IIIII)V"))
    private void noreclient$handle(DrawContext context, com.mojang.blaze3d.pipeline.RenderPipeline pipeline, Identifier texture, int x, int y, int w, int h, int color) {
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.sliderHandle(g, x, y, w, h, ((ClickableWidget) (Object) this).active);
        g.finish();
    }
}
