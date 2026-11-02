package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.Particles;
import net.minecraft.client.particle.Particle;
import net.minecraft.client.particle.ParticleEngine;
import net.minecraft.core.particles.ParticleOptions;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(ParticleEngine.class)
public abstract class ParticleManagerMixin {
    @Shadow
    public abstract void createTrackingEmitter(Entity entity, ParticleOptions parameters);

    @Unique
    private boolean noreclient$extra;

    @Unique
    private static Particles noreclient$module() {
        NoreClient c = NoreClient.get();
        if (c == null) return null;
        Particles p = c.modules().get(Particles.class);
        return p.isActive() ? p : null;
    }

    @Inject(method = "createParticle(Lnet/minecraft/core/particles/ParticleOptions;DDDDDD)Lnet/minecraft/client/particle/Particle;", at = @At("HEAD"), cancellable = true)
    private void noreclient$filter(ParticleOptions effect, double x, double y, double z, double vx, double vy, double vz, CallbackInfoReturnable<Particle> cir) {
        Particles p = noreclient$module();
        if (p == null) return;
        Identifier id = BuiltInRegistries.PARTICLE_TYPE.getKey(effect.getType());
        if (p.filter(id == null ? "" : id.getPath())) cir.setReturnValue(null);
    }

    @Inject(method = "createTrackingEmitter(Lnet/minecraft/world/entity/Entity;Lnet/minecraft/core/particles/ParticleOptions;)V", at = @At("TAIL"))
    private void noreclient$critMultiplier(Entity entity, ParticleOptions effect, CallbackInfo ci) {
        Particles p = noreclient$module();
        if (p == null || noreclient$extra || (effect.getType() != ParticleTypes.CRIT && effect.getType() != ParticleTypes.ENCHANTED_HIT)) return;
        noreclient$extra = true;
        for (int i = 1; i < p.critMultiplier.intValue(); i++) createTrackingEmitter(entity, effect);
        noreclient$extra = false;
    }
}
