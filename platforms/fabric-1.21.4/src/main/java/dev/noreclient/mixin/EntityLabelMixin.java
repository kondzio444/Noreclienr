package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import net.minecraft.client.render.entity.EntityRenderer;
import net.minecraft.entity.Entity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Friends' name tags get a green star (the label text is taken into the render state since 1.21.2). */
@Mixin(EntityRenderer.class)
public abstract class EntityLabelMixin {
    @Inject(method = "getDisplayName", at = @At("RETURN"), cancellable = true)
    private void noreclient$friendLabel(Entity entity, CallbackInfoReturnable<Text> cir) {
        Text text = cir.getReturnValue();
        if (text != null && entity instanceof PlayerEntity p && NoreClient.isFriendHighlighted(p.getGameProfile().getName())) {
            cir.setReturnValue(Text.literal("★ ").formatted(Formatting.GREEN).append(text));
        }
    }
}
