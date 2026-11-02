package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import net.minecraft.client.Minecraft;
import net.minecraft.client.MouseHandler;
import org.lwjgl.glfw.GLFW;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MouseHandler.class)
public abstract class MouseMixin {
    @Inject(method = "onButton", at = @At("HEAD"))
    private void noreclient$click(long window, net.minecraft.client.input.MouseButtonInfo input, int action, CallbackInfo ci) {
        int button = input.button();
        Minecraft mc = Minecraft.getInstance();
        if (window != mc.getWindow().handle()) return;
        NoreClient.onMouseButton(button, action == GLFW.GLFW_PRESS, mc.screen == null && mc.player != null);
    }

    @Inject(method = "onScroll", at = @At("HEAD"), cancellable = true)
    private void noreclient$scroll(long window, double horizontal, double vertical, CallbackInfo ci) {
        Minecraft mc = Minecraft.getInstance();
        if (vertical == 0 || mc.screen != null) return;
        if (NoreClient.onScroll(vertical)) ci.cancel();
    }
}
