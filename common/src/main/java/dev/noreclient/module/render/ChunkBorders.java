package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;

/** Vanilla chunk border lines (F3 + G) as a module: keybind, saved between sessions. */
public class ChunkBorders extends Module {
    private boolean applied;

    public ChunkBorders() {
        super("Chunk Borders", "Pokazuje granice chunków (jak F3 + G), także po ponownym uruchomieniu", Category.RENDER);
    }

    @Override
    public void onTick() {
        if (!inGame()) { applied = false; return; }
        if (applied) return;
        game().setChunkBorders(true);
        applied = true;
    }

    @Override
    protected void onDisable() {
        applied = false;
        if (inGame()) game().setChunkBorders(false);
    }
}
