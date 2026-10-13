package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;

public class NoHurtCam extends Module {
    public NoHurtCam() {
        super("No Hurt Cam", "Wyłącza trzęsienie kamery po otrzymaniu obrażeń", Category.RENDER);
    }

    @Override
    protected boolean needsHook() { return true; }
}
