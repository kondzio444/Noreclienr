package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.InactivityFpsLimiter;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Dynamic FPS: the frame limit lives here since 1.21.2. */
@Mixin(InactivityFpsLimiter.class)
public abstract class InactivityFpsLimiterMixin {
    @Inject(method = "update", at = @At("RETURN"), cancellable = true)
    private void noreclient$dynamicFps(CallbackInfoReturnable<Integer> cir) {
        int limit = NoreClient.framerateLimit(cir.getReturnValue(), MinecraftClient.getInstance().isWindowFocused());
        if (limit != cir.getReturnValue()) cir.setReturnValue(limit);
    }
}
