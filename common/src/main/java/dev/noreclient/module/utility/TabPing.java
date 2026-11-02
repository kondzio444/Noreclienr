package dev.noreclient.module.utility;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;

public class TabPing extends Module {
    public final BooleanSetting colored = add(new BooleanSetting("Colored", "Kolor zależny od pingu", true));
    public final BooleanSetting suffix = add(new BooleanSetting("ms Suffix", "Dopisek „ms”", false));

    public TabPing() {
        super("Tab Ping", "Ping w liczbach na liście graczy (Tab)", Category.UTILITY);
    }

    public static int color(int ping) {
        if (ping < 0) return 0xFFAAAAAA;
        if (ping < 80) return 0xFF55FF77;
        if (ping < 150) return 0xFFFFD255;
        if (ping < 300) return 0xFFFF9944;
        return 0xFFFF5555;
    }

    @Override
    protected boolean needsHook() { return true; }
}
