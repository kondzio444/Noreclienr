package dev.noreclient.mixin;

import dev.noreclient.platform.NoreText;
import net.minecraft.client.render.entity.EntityRenderer;
import net.minecraft.entity.Entity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Name tags: Nore icon for Nore users, green star for friends (the label text is taken into the render state since 1.21.2). */
@Mixin(EntityRenderer.class)
public abstract class EntityLabelMixin {
    @Inject(method = "getDisplayName", at = @At("RETURN"), cancellable = true)
    private void noreclient$friendLabel(Entity entity, CallbackInfoReturnable<Text> cir) {
        Text text = cir.getReturnValue();
        if (text != null && entity instanceof PlayerEntity p) cir.setReturnValue(NoreText.label(p.getGameProfile().getName(), text));
    }
}
