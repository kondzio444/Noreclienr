package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.CameraTweaks;
import dev.noreclient.module.render.Freelook;
import net.minecraft.client.Camera;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Camera.class)
public abstract class CameraMixin {
    @Shadow
    protected abstract void setRotation(float yaw, float pitch);

    @Inject(method = "setup", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Camera;setRotation(FF)V", ordinal = 0, shift = At.Shift.AFTER))
    private void noreclient$freelook(net.minecraft.world.level.Level area, Entity focusedEntity, boolean thirdPerson, boolean inverseView, float tickDelta, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        Freelook f = c.modules().get(Freelook.class);
        if (f.isLooking()) setRotation(f.getYaw(), f.getPitch());
    }

    @Inject(method = "getMaxZoom", at = @At("HEAD"), cancellable = true)
    private void noreclient$noClip(float desired, CallbackInfoReturnable<Float> cir) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        CameraTweaks t = c.modules().get(CameraTweaks.class);
        if (t.isActive() && t.noClip.isOn()) cir.setReturnValue(desired / 4f * t.distance.floatValue());
    }

    @ModifyVariable(method = "getMaxZoom", at = @At("HEAD"), argsOnly = true)
    private float noreclient$distance(float desired) {
        NoreClient c = NoreClient.get();
        if (c == null) return desired;
        CameraTweaks t = c.modules().get(CameraTweaks.class);
        return t.isActive() && !t.noClip.isOn() ? desired / 4f * t.distance.floatValue() : desired;
    }
}
