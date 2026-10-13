package dev.noreclient.module.hud;

import net.minecraft.client.network.PlayerListEntry;

public class PingHud extends TextHudModule {
    public PingHud() {
        super("Ping", "Opóźnienie połączenia z serwerem", 0.0f, 0.26f);
    }

    @Override protected String label() { return "Ping"; }

    @Override
    protected String value() {
        if (mc.getNetworkHandler() == null || mc.player == null) return "0ms";
        PlayerListEntry e = mc.getNetworkHandler().getPlayerListEntry(mc.player.getUuid());
        return (e == null ? 0 : e.getLatency()) + "ms";
    }

    @Override protected String previewValue() { return "24ms"; }
}
