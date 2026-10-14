package dev.noreclient.mixin.skin;

import dev.noreclient.gui.skin.VanillaSkin;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractSelectionList;
import net.minecraft.client.gui.components.AbstractWidget;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Worlds, servers, packs, controls...: themed list background, separators and selection. */
@Mixin(AbstractSelectionList.class)
public abstract class EntryListWidgetMixin {
    private AbstractWidget noreclient$self() { return (AbstractWidget) (Object) this; }

    @Inject(method = "extractListBackground", at = @At("HEAD"), cancellable = true)
    private void noreclient$background(GuiGraphicsExtractor context, CallbackInfo ci) {
        AbstractWidget w = noreclient$self();
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.listBackground(g, w.getX(), w.getY(), w.getWidth(), w.getHeight());
        g.finish();
        ci.cancel();
    }

    @Inject(method = "extractListSeparators", at = @At("HEAD"), cancellable = true)
    private void noreclient$separators(GuiGraphicsExtractor context, CallbackInfo ci) {
        AbstractWidget w = noreclient$self();
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.listSeparators(g, w.getX(), w.getY(), w.getY() + w.getHeight(), w.getWidth());
        g.finish();
        ci.cancel();
    }

    @Inject(method = "extractSelection", at = @At("HEAD"), cancellable = true)
    private void noreclient$selection(GuiGraphicsExtractor context, AbstractSelectionList.Entry<?> entry, int color, CallbackInfo ci) {
        GfxImpl g = new GfxImpl(context);
        VanillaSkin.selection(g, entry.getX(), entry.getY(), entry.getWidth(), entry.getHeight(), color == -1);
        g.finish();
        ci.cancel();
    }
}
