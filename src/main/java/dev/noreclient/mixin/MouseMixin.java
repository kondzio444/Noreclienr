package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.Zoom;
import dev.noreclient.util.ClickTracker;
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
        if (action == GLFW.GLFW_PRESS && mc.currentScreen == null && window == mc.getWindow().getHandle()) {
            ClickTracker.click(button);
        }
    }

    @Inject(method = "onMouseScroll", at = @At("HEAD"), cancellable = true)
    private void noreclient$scroll(long window, double horizontal, double vertical, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null || vertical == 0) return;
        if (c.modules().get(Zoom.class).onScroll(vertical)) ci.cancel();
    }
}
