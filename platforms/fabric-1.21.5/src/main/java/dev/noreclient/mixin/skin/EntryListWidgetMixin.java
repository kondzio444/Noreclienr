package dev.noreclient.mixin.skin;

import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.EntryListWidget;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Worlds, servers, packs, controls...: themed list background, separators and selection. */
@Mixin(EntryListWidget.class)
public abstract class EntryListWidgetMixin {
    private ClickableWidget noreclient$self() { return (ClickableWidget) (Object) this; }

    @Inject(method = "drawMenuListBackground", at = @At("HEAD"), cancellable = true)
    private void noreclient$background(DrawContext context, CallbackInfo ci) {
        ClickableWidget w = noreclient$self();
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.listBackground(g, w.getX(), w.getY(), w.getWidth(), w.getHeight());
        g.finish();
        ci.cancel();
    }

    @Inject(method = "drawHeaderAndFooterSeparators", at = @At("HEAD"), cancellable = true)
    private void noreclient$separators(DrawContext context, CallbackInfo ci) {
        ClickableWidget w = noreclient$self();
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.listSeparators(g, w.getX(), w.getY(), w.getY() + w.getHeight(), w.getWidth());
        g.finish();
        ci.cancel();
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
