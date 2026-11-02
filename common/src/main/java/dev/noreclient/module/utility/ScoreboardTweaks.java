package dev.noreclient.module.utility;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;

public class ScoreboardTweaks extends Module {
    public ScoreboardTweaks() {
        super("Hide Scoreboard", "Ukrywa tablicę wyników z prawej strony", Category.UTILITY);
    }

    @Override
    protected boolean needsHook() { return true; }
}
