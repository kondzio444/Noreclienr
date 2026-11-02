package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.Particles;
import net.minecraft.block.BlockState;
import net.minecraft.client.particle.Particle;
import net.minecraft.client.particle.ParticleManager;
import net.minecraft.entity.Entity;
import net.minecraft.particle.ParticleEffect;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(ParticleManager.class)
public abstract class ParticleManagerMixin {
    @Shadow
    public abstract void addEmitter(Entity entity, ParticleEffect parameters);

    @Unique
    private boolean noreclient$extra;

    @Unique
    private static Particles noreclient$module() {
        NoreClient c = NoreClient.get();
        if (c == null) return null;
        Particles p = c.modules().get(Particles.class);
        return p.isActive() ? p : null;
    }

    @Inject(method = "addParticle(Lnet/minecraft/particle/ParticleEffect;DDDDDD)Lnet/minecraft/client/particle/Particle;", at = @At("HEAD"), cancellable = true)
    private void noreclient$filter(ParticleEffect effect, double x, double y, double z, double vx, double vy, double vz, CallbackInfoReturnable<Particle> cir) {
        Particles p = noreclient$module();
        if (p == null) return;
        Identifier id = Registries.PARTICLE_TYPE.getId(effect.getType());
        if (p.filter(id == null ? "" : id.getPath())) cir.setReturnValue(null);
    }

    @Inject(method = "addBlockBreakParticles", at = @At("HEAD"), cancellable = true)
    private void noreclient$blockBreak(BlockPos pos, BlockState state, CallbackInfo ci) {
        Particles p = noreclient$module();
        if (p != null && !p.blockBreak.isOn()) ci.cancel();
    }

    @Inject(method = "addEmitter(Lnet/minecraft/entity/Entity;Lnet/minecraft/particle/ParticleEffect;)V", at = @At("TAIL"))
    private void noreclient$critMultiplier(Entity entity, ParticleEffect effect, CallbackInfo ci) {
        Particles p = noreclient$module();
        if (p == null || noreclient$extra || (effect.getType() != ParticleTypes.CRIT && effect.getType() != ParticleTypes.ENCHANTED_HIT)) return;
        noreclient$extra = true;
        for (int i = 1; i < p.critMultiplier.intValue(); i++) addEmitter(entity, effect);
        noreclient$extra = false;
    }
}
