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

    @Inject(method = "render", at = @At("TAIL"))
    private void noreclient$overlay(DrawContext context, int mouseX, int mouseY, float delta, CallbackInfo ci) {
        context.getMatrices().push();
        context.getMatrices().translate(0, 0, 300);
        GfxImpl g = new GfxImpl(context);
        NoreClient.onRenderContainer(g, x, y, backgroundWidth, backgroundHeight, mouseX, mouseY);
        g.finish();
        context.getMatrices().pop();
    }

    @Inject(method = "mouseClicked", at = @At("HEAD"), cancellable = true)
    private void noreclient$click(double mouseX, double mouseY, int button, CallbackInfoReturnable<Boolean> cir) {
        if (NoreClient.onContainerClick(mouseX, mouseY, button)) cir.setReturnValue(true);
    }
}
