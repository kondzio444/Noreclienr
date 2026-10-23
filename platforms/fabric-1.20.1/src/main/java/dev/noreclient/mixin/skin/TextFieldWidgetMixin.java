package dev.noreclient.mixin.skin;

import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** 1.20–1.20.1 draw the text field frame as two fills (border, then black inside). */
@Mixin(TextFieldWidget.class)
public abstract class TextFieldWidgetMixin {
    @Redirect(method = "renderButton", at = @At(value = "INVOKE", ordinal = 0,
            target = "Lnet/minecraft/client/gui/DrawContext;fill(IIIII)V"))
    private void noreclient$frame(DrawContext context, int x1, int y1, int x2, int y2, int color) {
        ClickableWidget self = (ClickableWidget) (Object) this;
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.textField(g, self.getX(), self.getY(), self.getWidth(), self.getHeight(), self.isFocused());
        g.finish();
    }

    @Redirect(method = "renderButton", at = @At(value = "INVOKE", ordinal = 1,
            target = "Lnet/minecraft/client/gui/DrawContext;fill(IIIII)V"))
    private void noreclient$inside(DrawContext context, int x1, int y1, int x2, int y2, int color) {
        // drawn by noreclient$frame
    }
}
