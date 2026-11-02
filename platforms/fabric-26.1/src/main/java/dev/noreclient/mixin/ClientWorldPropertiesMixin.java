package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.TimeChanger;
import net.minecraft.client.ClientClockManager;
import net.minecraft.core.Holder;
import net.minecraft.world.clock.WorldClock;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Time Changer: 26.1 replaced the client day time with world clocks. */
@Mixin(ClientClockManager.class)
public abstract class ClientWorldPropertiesMixin {
    @Inject(method = "getTotalTicks", at = @At("HEAD"), cancellable = true)
    private void noreclient$time(Holder<WorldClock> clock, CallbackInfoReturnable<Long> cir) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        TimeChanger t = c.modules().get(TimeChanger.class);
        if (t.isActive()) cir.setReturnValue(t.getTime());
    }
}
