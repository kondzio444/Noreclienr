package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import net.minecraft.client.Minecraft;
import net.minecraft.client.MouseHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MouseHandler.class)
public abstract class MouseMixin {
    @Inject(method = "onButton", at = @At("HEAD"))
    private void noreclient$click(long window, net.minecraft.client.input.MouseButtonInfo input, int action, CallbackInfo ci) {
        int button = dev.noreclient.platform.KeyCodes.mouseToGlfw(input.button()); // SDL 1 = left
        Minecraft mc = Minecraft.getInstance();
        if (window != mc.getWindow().handle()) return;
        NoreClient.onMouseButton(button, action == com.mojang.blaze3d.platform.InputConstants.PRESS, mc.gui.screen() == null && mc.player != null);
    }

    @Inject(method = "onScroll", at = @At("HEAD"), cancellable = true)
    private void noreclient$scroll(long window, double horizontal, double vertical, CallbackInfo ci) {
        Minecraft mc = Minecraft.getInstance();
        if (vertical == 0 || mc.gui.screen() != null) return;
        if (NoreClient.onScroll(vertical)) ci.cancel();
    }
}
