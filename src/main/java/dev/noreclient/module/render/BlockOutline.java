package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.ColorSetting;

public class BlockOutline extends Module {
    public final ColorSetting color = add(new ColorSetting("Outline Color", "Kolor obrysu bloku", 0xCCFF8A1F));

    public BlockOutline() {
        super("Block Outline", "Kolorowy obrys bloku pod celownikiem", Category.RENDER);
    }
}
