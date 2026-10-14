package dev.noreclient.platform;

import dev.noreclient.NoreClient;
import net.fabricmc.api.ClientModInitializer;

public class NoreEntrypoint implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        if (!NoreMixinPlugin.allowed()) return; // not started by Nore Launcher
        String platform = net.fabricmc.loader.api.FabricLoader.getInstance().getModContainer("noreclient")
                .map(m -> m.getMetadata().getCustomValue("noreclient:platform")).map(v -> v.getAsString()).orElse("fabric");
        NoreClient.start(new GameImpl(), platform, "*");
    }
}
