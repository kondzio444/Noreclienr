package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.Mouse;
import org.lwjgl.glfw.GLFW;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Mouse.class)
public abstract class MouseMixin {
    @Inject(method = "onMouseButton", at = @At("HEAD"))
    private void noreclient$click(long window, int button, int action, int mods, CallbackInfo ci) {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (window != mc.getWindow().getHandle()) return;
        NoreClient.onMouseButton(button, action == GLFW.GLFW_PRESS, mc.currentScreen == null && mc.player != null);
    }

    @Inject(method = "onMouseScroll", at = @At("HEAD"), cancellable = true)
    private void noreclient$scroll(long window, double horizontal, double vertical, CallbackInfo ci) {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (vertical == 0 || mc.currentScreen != null) return;
        if (NoreClient.onScroll(vertical)) ci.cancel();
    }
}
