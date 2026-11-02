package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;

/** Entity hitboxes on/off without F3+B. */
public class Hitboxes extends Module {
    private boolean applied;

    public Hitboxes() {
        super("Hitboxes", "Pokazuje hitboxy bytów (jak F3+B)", Category.RENDER);
    }

    @Override
    public void onTick() {
        if (applied || !inGame()) return;
        game().setRenderHitboxes(true);
        applied = true;
    }

    @Override
    protected void onDisable() {
        applied = false;
        if (inGame()) game().setRenderHitboxes(false);
    }
}
