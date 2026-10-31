package dev.noreclient.mixin.skin;

import com.mojang.blaze3d.systems.RenderSystem;
import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.EntryListWidget;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.util.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Worlds, servers, packs, controls...: themed list background, separators and selection.
 * (1.20.2–1.20.4 draw a darkened dirt texture and two shadow gradients inside renderWidget.)
 */
@Mixin(EntryListWidget.class)
public abstract class EntryListWidgetMixin {
    private ClickableWidget noreclient$self() { return (ClickableWidget) (Object) this; }

    @Redirect(method = "renderWidget", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/client/gui/DrawContext;drawTexture(Lnet/minecraft/util/Identifier;IIFFIIII)V"))
    private void noreclient$background(DrawContext context, Identifier texture, int x, int y, float u, float v, int w, int h, int tw, int th) {
        RenderSystem.setShaderColor(1, 1, 1, 1); // vanilla darkens the dirt texture through the shader colour
        ClickableWidget self = noreclient$self();
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.listBackground(g, self.getX(), self.getY(), self.getWidth(), self.getHeight());
        g.finish();
    }

    @Redirect(method = "renderWidget", at = @At(value = "INVOKE", ordinal = 0,
            target = "Lnet/minecraft/client/gui/DrawContext;fillGradient(Lnet/minecraft/client/render/RenderLayer;IIIIIII)V"))
    private void noreclient$separators(DrawContext context, RenderLayer layer, int x1, int y1, int x2, int y2, int c1, int c2, int z) {
        ClickableWidget w = noreclient$self();
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.listSeparators(g, w.getX(), w.getY(), w.getY() + w.getHeight(), w.getWidth());
        g.finish();
    }

    @Redirect(method = "renderWidget", at = @At(value = "INVOKE", ordinal = 1,
            target = "Lnet/minecraft/client/gui/DrawContext;fillGradient(Lnet/minecraft/client/render/RenderLayer;IIIIIII)V"))
    private void noreclient$bottomShadow(DrawContext context, RenderLayer layer, int x1, int y1, int x2, int y2, int c1, int c2, int z) {
        // both separators are drawn by noreclient$separators
    }

    @Inject(method = "drawSelectionHighlight", at = @At("HEAD"), cancellable = true)
    private void noreclient$selection(DrawContext context, int y, int entryWidth, int entryHeight, int borderColor, int fillColor, CallbackInfo ci) {
        ClickableWidget w = noreclient$self();
        float x = w.getX() + (w.getWidth() - entryWidth) / 2f;
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.selection(g, x, y - 2, entryWidth, entryHeight + 4, borderColor == -1);
        g.finish();
        ci.cancel();
    }
}
