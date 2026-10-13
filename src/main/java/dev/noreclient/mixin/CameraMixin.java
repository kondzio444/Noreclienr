package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.Freelook;
import net.minecraft.client.render.Camera;
import net.minecraft.entity.Entity;
import net.minecraft.world.BlockView;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Camera.class)
public abstract class CameraMixin {
    @Shadow
    protected abstract void setRotation(float yaw, float pitch);

    @Inject(method = "update", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/render/Camera;setRotation(FF)V", ordinal = 0, shift = At.Shift.AFTER))
    private void noreclient$freelook(BlockView area, Entity focusedEntity, boolean thirdPerson, boolean inverseView, float tickDelta, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        Freelook f = c.modules().get(Freelook.class);
        if (f.isActive()) setRotation(f.getYaw(), f.getPitch());
    }
}
