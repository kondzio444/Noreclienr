package dev.noreclient.mixin;

import dev.noreclient.platform.NoreText;
import net.minecraft.resource.ResourcePack;
import net.minecraft.resource.ResourcePackManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.ArrayList;
import java.util.List;

/** Adds the mod's own assets (the Nore icon font) on top of the client's resource packs. */
@Mixin(ResourcePackManager.class)
public abstract class NorePackMixin {
    @Inject(method = "createResourcePacks", at = @At("RETURN"), cancellable = true)
    private void noreclient$assets(CallbackInfoReturnable<List<ResourcePack>> cir) {
        ResourcePack pack = NoreText.pack(this);
        if (pack == null) return;
        List<ResourcePack> list = new ArrayList<>(cir.getReturnValue());
        list.add(pack);
        cir.setReturnValue(list);
    }
}
