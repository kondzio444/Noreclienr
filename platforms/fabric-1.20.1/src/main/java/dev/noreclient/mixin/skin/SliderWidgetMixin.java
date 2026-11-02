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

    @Redirect(method = "renderButton", at = @At(value = "INVOKE", ordinal = 0,
            target = "Lnet/minecraft/client/gui/DrawContext;drawNineSlicedTexture(Lnet/minecraft/util/Identifier;IIIIIIIIII)V"))
    private void noreclient$track(DrawContext context, Identifier texture, int x, int y, int w, int h, int a, int b, int c, int d, int e, int f) {
        ClickableWidget self = (ClickableWidget) (Object) this;
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.sliderTrack(g, self, x, y, w, h, value, self.isSelected(), self.active);
        g.finish();
    }

    @Redirect(method = "renderButton", at = @At(value = "INVOKE", ordinal = 1,
            target = "Lnet/minecraft/client/gui/DrawContext;drawNineSlicedTexture(Lnet/minecraft/util/Identifier;IIIIIIIIII)V"))
    private void noreclient$handle(DrawContext context, Identifier texture, int x, int y, int w, int h, int a, int b, int c, int d, int e, int f) {
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.sliderHandle(g, x, y, w, h, ((ClickableWidget) (Object) this).active);
        g.finish();
    }
}
