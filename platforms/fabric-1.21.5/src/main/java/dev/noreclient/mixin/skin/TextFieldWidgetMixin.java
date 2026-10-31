package dev.noreclient.mixin.skin;

import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.util.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(TextFieldWidget.class)
public abstract class TextFieldWidgetMixin {
    @Redirect(method = "renderWidget", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/client/gui/DrawContext;drawGuiTexture(Ljava/util/function/Function;Lnet/minecraft/util/Identifier;IIII)V"))
    private void noreclient$frame(DrawContext context, java.util.function.Function<Identifier, net.minecraft.client.render.RenderLayer> layers, Identifier texture, int x, int y, int w, int h) {
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.textField(g, x, y, w, h, ((ClickableWidget) (Object) this).isFocused());
        g.finish();
    }
}
