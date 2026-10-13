package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.utility.TabPing;
import dev.noreclient.util.Render2D;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.hud.PlayerListHud;
import net.minecraft.client.network.PlayerListEntry;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(PlayerListHud.class)
public abstract class PlayerListHudMixin {
    @Inject(method = "renderLatencyIcon", at = @At("HEAD"), cancellable = true)
    private void noreclient$ping(DrawContext context, int width, int x, int y, PlayerListEntry entry, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        TabPing t = c.modules().get(TabPing.class);
        if (!t.isEnabled()) return;
        ci.cancel();
        int ping = entry.getLatency();
        String s = ping + (t.suffix.isOn() ? "ms" : "");
        int color = t.colored.isOn() ? TabPing.color(ping) : 0xFFFFFFFF;
        float scale = 0.75f;
        Render2D.scaledText(context, s, x + width - 1 - Render2D.textWidth(s) * scale, y + 1.5f, scale, color, true);
    }
}
