package dev.noreclient.module.hud;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.module.Category;
import dev.noreclient.module.HudModule;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Animated list of enabled modules. */
public class ModuleListHud extends HudModule {
    public final ModeSetting colorMode = add(new ModeSetting("Color", "Kolorowanie wpisów", "Theme", "Theme", "Rainbow", "Category", "White"));
    public final BooleanSetting background = add(new BooleanSetting("Background", "Tło za wpisami", true));
    public final BooleanSetting sideBar = add(new BooleanSetting("Side Bar", "Pasek akcentu z boku", true));
    public final BooleanSetting suffixes = add(new BooleanSetting("Suffixes", "Dodatkowe informacje przy nazwie", true));
    public final BooleanSetting showHud = add(new BooleanSetting("Include HUD", "Pokazuj też moduły HUD", false));
    public final ModeSetting sorting = add(new ModeSetting("Sorting", "Kolejność wpisów", "Length", "Length", "Alphabetical"));

    private final Map<Module, Animation> anims = new HashMap<Module, Animation>();

    public ModuleListHud() {
        super("Module List", "Lista włączonych modułów", 1.0f, 0.0f);
        setEnabled(true);
    }

    private String text(Module m) {
        String s = m.getName();
        if (suffixes.isOn() && m.getSuffix() != null) s += " §7" + m.getSuffix();
        return s;
    }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        List<Module> list = new ArrayList<Module>();
        for (Module m : NoreClient.get().modules().getModules()) {
            if (!m.isToggleable() || m.getCategory() == Category.CLIENT) continue;
            if (m instanceof HudModule && !showHud.isOn()) continue;
            Animation a = anims.get(m);
            if (a == null) { a = new Animation(0, 12); anims.put(m, a); }
            a.target(m.isEnabled() ? 1 : 0);
            a.update();
            if (a.get() > 0.01f) list.add(m);
        }
        if (sorting.is("Length")) {
            Collections.sort(list, new Comparator<Module>() {
                @Override public int compare(Module a, Module b) { return Render2D.textWidth(text(b)) - Render2D.textWidth(text(a)); }
            });
        } else {
            Collections.sort(list, new Comparator<Module>() {
                @Override public int compare(Module a, Module b) { return a.getName().compareTo(b.getName()); }
            });
        }
        if (list.isEmpty() && editor) {
            width = 70;
            height = 12;
            Render2D.text(g, "Module List", 2, 2, 0x80FFFFFF, true);
            return;
        }
        int maxW = 0;
        for (Module m : list) maxW = Math.max(maxW, Render2D.textWidth(text(m)));
        width = maxW + 8;
        boolean right = rightAligned();
        float y = 0;
        int i = 0;
        for (Module m : list) {
            float a = anims.get(m).get();
            String s = text(m);
            int w = Render2D.textWidth(s) + 6;
            float lineH = 11 * a;
            float slide = (1 - a) * (w + 4);
            float x = right ? width - w - 2 + slide : -slide;
            int color;
            if (colorMode.is("Rainbow")) color = ColorUtil.rainbow(-i * 180L, 0.7f, 0.6f, 1f, 255);
            else if (colorMode.is("Category")) color = m.getCategory().color;
            else if (colorMode.is("White")) color = 0xFFFFFFFF;
            else color = Theme.accent(-i * 150L);
            color = ColorUtil.fade(color, a);
            if (background.isOn()) Render2D.rect(g, x, y, w, lineH, ColorUtil.fade(0x90000000, a));
            if (sideBar.isOn()) Render2D.rect(g, right ? x + w : x - 2, y, 2, lineH, color);
            Render2D.text(g, s, x + 3, y + 1.5f, color, true);
            y += lineH;
            i++;
        }
        height = Math.max(11, y);
    }
}
