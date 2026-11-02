package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.Particles;
import net.minecraft.block.BlockState;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.util.math.BlockPos;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Block break particles are spawned by the client world since 1.21.9. */
@Mixin(ClientWorld.class)
public abstract class ClientWorldMixin {
    @Inject(method = "addBlockBreakParticles", at = @At("HEAD"), cancellable = true)
    private void noreclient$blockBreak(BlockPos pos, BlockState state, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        Particles p = c.modules().get(Particles.class);
        if (p.isActive() && !p.blockBreak.isOn()) ci.cancel();
    }
}
