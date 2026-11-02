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

/** Buttons and cycling buttons: Nore frame instead of the vanilla button texture. */
@Mixin(PressableWidget.class)
public abstract class PressableWidgetMixin {
    @Redirect(method = "renderWidget", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/client/gui/DrawContext;drawGuiTexture(Lnet/minecraft/util/Identifier;IIII)V"))
    private void noreclient$frame(DrawContext context, Identifier texture, int x, int y, int w, int h) {
        ClickableWidget self = (ClickableWidget) (Object) this;
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.button(g, self, x, y, w, h, self.isSelected(), self.active);
        g.finish();
    }
}
