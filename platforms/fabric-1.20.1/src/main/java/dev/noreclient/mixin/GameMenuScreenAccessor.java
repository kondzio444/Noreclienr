package dev.noreclient.mixin;

import net.minecraft.client.gui.screen.GameMenuScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** 1.20–1.20.1: GameMenuScreen has no public shouldShowMenu() yet. */
@Mixin(GameMenuScreen.class)
public interface GameMenuScreenAccessor {
    @Accessor("showMenu")
    boolean noreclient$showMenu();
}
