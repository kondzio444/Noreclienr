package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.utility.TabPing;
import dev.noreclient.platform.GfxImpl;
import dev.noreclient.util.Render2D;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.PlayerTabOverlay;
import net.minecraft.client.multiplayer.PlayerInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(PlayerTabOverlay.class)
public abstract class PlayerListHudMixin {
    @Inject(method = "extractPingIcon", at = @At("HEAD"), cancellable = true)
    private void noreclient$ping(GuiGraphicsExtractor context, int width, int x, int y, PlayerInfo entry, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        TabPing t = c.modules().get(TabPing.class);
        if (!t.isActive()) return;
        ci.cancel();
        int ping = entry.getLatency();
        String s = ping + (t.suffix.isOn() ? "ms" : "");
        int color = t.colored.isOn() ? TabPing.color(ping) : 0xFFFFFFFF;
        float scale = 0.75f;
        GfxImpl g = new GfxImpl(context);
        Render2D.scaledText(g, s, x + width - 1 - Render2D.textWidth(s) * scale, y + 1.5f, scale, color, true);
        g.finish();
    }
}
