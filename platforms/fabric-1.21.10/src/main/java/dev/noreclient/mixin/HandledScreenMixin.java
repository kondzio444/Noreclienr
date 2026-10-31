package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.ingame.HandledScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Client panels next to containers (Auto Craft). */
@Mixin(HandledScreen.class)
public abstract class HandledScreenMixin {
    @Shadow protected int x;
    @Shadow protected int y;
    @Shadow protected int backgroundWidth;
    @Shadow protected int backgroundHeight;

    // RecipeBookScreen (inventory, crafting table) skips HandledScreen.render since 1.21.6; both call renderMain
    @Inject(method = "renderMain", at = @At("TAIL"))
    private void noreclient$overlay(DrawContext context, int mouseX, int mouseY, float delta, CallbackInfo ci) {
        context.createNewRootLayer(); // above the items / vanilla splash
        GfxImpl g = new GfxImpl(context);
        NoreClient.onRenderContainer(g, x, y, backgroundWidth, backgroundHeight, mouseX, mouseY);
        g.finish();
    }

    @Inject(method = "mouseClicked", at = @At("HEAD"), cancellable = true)
    private void noreclient$click(net.minecraft.client.gui.Click click, boolean doubled, CallbackInfoReturnable<Boolean> cir) {
        if (NoreClient.onContainerClick(click.x(), click.y(), click.button())) cir.setReturnValue(true);
    }
}
