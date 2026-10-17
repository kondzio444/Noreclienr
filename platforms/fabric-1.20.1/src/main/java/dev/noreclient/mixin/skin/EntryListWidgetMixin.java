package dev.noreclient.mixin.skin;

import com.mojang.blaze3d.systems.RenderSystem;
import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.widget.EntryListWidget;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.util.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Worlds, servers, packs, controls...: themed list background, separators and selection.
 * (1.20–1.20.1: the list is not a widget yet; it draws darkened dirt behind the rows and over the
 * header/footer area, plus two shadow gradients, all inside render. The header/footer dirt is
 * replaced by a full-screen Nore backdrop drawn before the rows.)
 */
@Mixin(EntryListWidget.class)
public abstract class EntryListWidgetMixin {
    @Shadow protected int width;
    @Shadow protected int top;
    @Shadow protected int bottom;
    @Shadow protected int left;
    @Shadow private boolean renderHorizontalShadows;

    @Redirect(method = "render", at = @At(value = "INVOKE", ordinal = 0,
            target = "Lnet/minecraft/client/gui/DrawContext;drawTexture(Lnet/minecraft/util/Identifier;IIFFIIII)V"))
    private void noreclient$background(DrawContext context, Identifier texture, int x, int y, float u, float v, int w, int h, int tw, int th) {
        RenderSystem.setShaderColor(1, 1, 1, 1); // vanilla darkens the dirt texture through the shader colour
        GfxImpl g = new GfxImpl(context);
        if (renderHorizontalShadows) {
            // Screens with such a list (worlds, servers, packs...) draw no background of their own in 1.20.1:
            // vanilla covers the header and footer with dirt instead. Lay the full backdrop first.
            int sw = context.getScaledWindowWidth(), sh = context.getScaledWindowHeight();
            if (MinecraftClient.getInstance().world == null) VanillaSkin.menuBackground(g, sw, sh);
            else context.fillGradient(0, 0, sw, sh, 0xC0101010, 0xD0101010);
        }
        VanillaSkin.listBackground(g, left, top, width, bottom - top);
        g.finish();
    }

    @Redirect(method = "render", at = @At(value = "INVOKE", ordinal = 1,
            target = "Lnet/minecraft/client/gui/DrawContext;drawTexture(Lnet/minecraft/util/Identifier;IIFFIIII)V"))
    private void noreclient$header(DrawContext context, Identifier texture, int x, int y, float u, float v, int w, int h, int tw, int th) {
        // the screen's own (Nore) background stays visible above the list
    }

    @Redirect(method = "render", at = @At(value = "INVOKE", ordinal = 2,
            target = "Lnet/minecraft/client/gui/DrawContext;drawTexture(Lnet/minecraft/util/Identifier;IIFFIIII)V"))
    private void noreclient$footer(DrawContext context, Identifier texture, int x, int y, float u, float v, int w, int h, int tw, int th) {
        // ...and below it
    }

    @Redirect(method = "render", at = @At(value = "INVOKE", ordinal = 0,
            target = "Lnet/minecraft/client/gui/DrawContext;fillGradient(Lnet/minecraft/client/render/RenderLayer;IIIIIII)V"))
    private void noreclient$separators(DrawContext context, RenderLayer layer, int x1, int y1, int x2, int y2, int c1, int c2, int z) {
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.listSeparators(g, left, top, bottom, width);
        g.finish();
    }

    @Redirect(method = "render", at = @At(value = "INVOKE", ordinal = 1,
            target = "Lnet/minecraft/client/gui/DrawContext;fillGradient(Lnet/minecraft/client/render/RenderLayer;IIIIIII)V"))
    private void noreclient$bottomShadow(DrawContext context, RenderLayer layer, int x1, int y1, int x2, int y2, int c1, int c2, int z) {
        // both separators are drawn by noreclient$separators
    }

    @Inject(method = "drawSelectionHighlight", at = @At("HEAD"), cancellable = true)
    private void noreclient$selection(DrawContext context, int y, int entryWidth, int entryHeight, int borderColor, int fillColor, CallbackInfo ci) {
        float x = left + (width - entryWidth) / 2f;
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.selection(g, x, y - 2, entryWidth, entryHeight + 4, borderColor == -1);
        g.finish();
        ci.cancel();
    }
}
