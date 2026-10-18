package dev.noreclient.mixin;

import dev.noreclient.platform.NoreText;
import net.minecraft.server.packs.PackResources;
import net.minecraft.server.packs.repository.PackRepository;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.ArrayList;
import java.util.List;

/** Adds the mod's own assets (the Nore icon font) on top of the client's resource packs. */
@Mixin(PackRepository.class)
public abstract class NorePackMixin {
    @Inject(method = "openAllSelected", at = @At("RETURN"), cancellable = true)
    private void noreclient$assets(CallbackInfoReturnable<List<PackResources>> cir) {
        PackResources pack = NoreText.pack(this);
        if (pack == null) return;
        List<PackResources> list = new ArrayList<>(cir.getReturnValue());
        list.add(pack);
        cir.setReturnValue(list);
    }
}
