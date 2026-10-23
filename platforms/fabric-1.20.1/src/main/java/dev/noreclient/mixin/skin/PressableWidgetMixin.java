package dev.noreclient.mixin.skin;

import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.PressableWidget;
import net.minecraft.util.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** Buttons and cycling buttons: Nore frame instead of the vanilla (1.20–1.20.1 nine-sliced) button texture. */
@Mixin(PressableWidget.class)
public abstract class PressableWidgetMixin {
    @Redirect(method = "renderButton", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/client/gui/DrawContext;drawNineSlicedTexture(Lnet/minecraft/util/Identifier;IIIIIIIIII)V"))
    private void noreclient$frame(DrawContext context, Identifier texture, int x, int y, int w, int h, int a, int b, int c, int d, int e, int f) {
        ClickableWidget self = (ClickableWidget) (Object) this;
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.button(g, self, x, y, w, h, self.isSelected(), self.active);
        g.finish();
    }
}
