package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;

public class SelfNametag extends Module {
    public SelfNametag() {
        super("Self Nametag", "Pokazuje Twój nick nad głową w widoku F5", Category.RENDER);
    }

    @Override
    protected boolean needsHook() { return true; }
}
