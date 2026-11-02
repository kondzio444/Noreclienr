package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Client panels next to containers (Auto Craft). */
@Mixin(AbstractContainerScreen.class)
public abstract class HandledScreenMixin {
    @Shadow protected int leftPos;
    @Shadow protected int topPos;
    @Shadow protected int imageWidth;
    @Shadow protected int imageHeight;

    // RecipeBookScreen (inventory, crafting table) skips HandledScreen.render since 1.21.6; both call renderMain
    @Inject(method = "renderContents", at = @At("TAIL"))
    private void noreclient$overlay(GuiGraphics context, int mouseX, int mouseY, float delta, CallbackInfo ci) {
        context.nextStratum(); // above the items / vanilla splash
        GfxImpl g = new GfxImpl(context);
        NoreClient.onRenderContainer(g, leftPos, topPos, imageWidth, imageHeight, mouseX, mouseY);
        g.finish();
    }

    @Inject(method = "mouseClicked", at = @At("HEAD"), cancellable = true)
    private void noreclient$click(net.minecraft.client.input.MouseButtonEvent click, boolean doubled, CallbackInfoReturnable<Boolean> cir) {
        if (NoreClient.onContainerClick(click.x(), click.y(), click.button())) cir.setReturnValue(true);
    }
}
