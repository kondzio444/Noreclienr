package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.ClearWeather;
import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Level.class)
public abstract class WorldMixin {
    @Shadow
    public abstract boolean isClientSide();

    private boolean noreclient$clear() {
        NoreClient c = NoreClient.get();
        return isClientSide() && c != null && c.modules().get(ClearWeather.class).isActive();
    }

    @Inject(method = "getRainLevel", at = @At("HEAD"), cancellable = true)
    private void noreclient$rain(float delta, CallbackInfoReturnable<Float> cir) {
        if (noreclient$clear()) cir.setReturnValue(0f);
    }

    @Inject(method = "getThunderLevel", at = @At("HEAD"), cancellable = true)
    private void noreclient$thunder(float delta, CallbackInfoReturnable<Float> cir) {
        if (noreclient$clear()) cir.setReturnValue(0f);
    }
}
