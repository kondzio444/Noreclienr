package dev.noreclient.util;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.sound.PositionedSoundInstance;
import net.minecraft.sound.SoundEvents;

public final class Sounds {
    private Sounds() {}

    public static void click() {
        if (Theme.sounds()) MinecraftClient.getInstance().getSoundManager()
                .play(PositionedSoundInstance.master(SoundEvents.UI_BUTTON_CLICK.value(), 1.0f, 0.35f));
    }

    public static void toggle(boolean on) {
        if (Theme.sounds()) MinecraftClient.getInstance().getSoundManager()
                .play(PositionedSoundInstance.master(SoundEvents.UI_BUTTON_CLICK.value(), on ? 1.4f : 0.9f, 0.3f));
    }
}
