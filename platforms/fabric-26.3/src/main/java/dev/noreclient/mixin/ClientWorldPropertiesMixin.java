package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.TimeChanger;
import net.minecraft.client.ClientClockManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Time Changer: 26.3 keeps every world clock in a ClientClockInstance. */
@Mixin(ClientClockManager.ClientClockInstance.class)
public abstract class ClientWorldPropertiesMixin {
    @Inject(method = "totalTicks", at = @At("HEAD"), cancellable = true)
    private void noreclient$time(CallbackInfoReturnable<Long> cir) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        TimeChanger t = c.modules().get(TimeChanger.class);
        if (t.isActive()) cir.setReturnValue(t.getTime());
    }
}
