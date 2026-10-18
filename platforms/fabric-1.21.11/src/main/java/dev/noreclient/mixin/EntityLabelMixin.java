package dev.noreclient.mixin;

import dev.noreclient.platform.NoreText;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Name tags: Nore icon for Nore users, green star for friends (the label text is taken into the render state since 1.21.2). */
@Mixin(EntityRenderer.class)
public abstract class EntityLabelMixin {
    @Inject(method = "getNameTag", at = @At("RETURN"), cancellable = true)
    private void noreclient$friendLabel(Entity entity, CallbackInfoReturnable<Component> cir) {
        Component text = cir.getReturnValue();
        if (text != null && entity instanceof Player p) cir.setReturnValue(NoreText.label(p.getGameProfile().name(), text));
    }
}
