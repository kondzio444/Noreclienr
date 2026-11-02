package dev.noreclient.mixin;

import dev.noreclient.platform.NoreText;
import net.minecraft.client.render.entity.EntityRenderer;
import net.minecraft.entity.Entity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/** Name tags: Nore icon for Nore users, green star for friends. */
@Mixin(EntityRenderer.class)
public abstract class EntityLabelMixin {
    @ModifyVariable(method = "renderLabelIfPresent", at = @At("HEAD"), argsOnly = true)
    private Text noreclient$friendLabel(Text text, Entity entity, Text original, net.minecraft.client.util.math.MatrixStack matrices,
                                        net.minecraft.client.render.VertexConsumerProvider consumers, int light) {
        if (entity instanceof PlayerEntity p) return NoreText.label(p.getGameProfile().getName(), text);
        return text;
    }
}
