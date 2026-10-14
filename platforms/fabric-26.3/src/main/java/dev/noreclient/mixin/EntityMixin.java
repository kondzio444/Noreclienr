package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.Freelook;
import dev.noreclient.module.render.Zoom;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Entity.class)
public abstract class EntityMixin {
    private boolean noreclient$isLocalPlayer() {
        return (Object) this == Minecraft.getInstance().player && NoreClient.get() != null;
    }

    @ModifyVariable(method = "turn", at = @At("HEAD"), argsOnly = true, ordinal = 0)
    private double noreclient$zoomSensX(double dx) {
        if (!noreclient$isLocalPlayer()) return dx;
        return dx * NoreClient.get().modules().get(Zoom.class).sensitivityMultiplier();
    }

    @ModifyVariable(method = "turn", at = @At("HEAD"), argsOnly = true, ordinal = 1)
    private double noreclient$zoomSensY(double dy) {
        if (!noreclient$isLocalPlayer()) return dy;
        return dy * NoreClient.get().modules().get(Zoom.class).sensitivityMultiplier();
    }

    @Inject(method = "turn", at = @At("HEAD"), cancellable = true)
    private void noreclient$freelook(double dx, double dy, CallbackInfo ci) {
        if (!noreclient$isLocalPlayer()) return;
        Freelook f = NoreClient.get().modules().get(Freelook.class);
        if (f.isLooking()) {
            f.addRotation(dx, dy);
            ci.cancel();
        }
    }
}
