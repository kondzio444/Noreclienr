package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.api.TargetInfo;
import dev.noreclient.module.HudModule;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Counts totems of undying used by every player around you (and you) in this session. */
public class TotemPopHud extends HudModule {
    public final BooleanSetting notify = add(new BooleanSetting("Notify", "Powiadomienie przy każdym zużytym totemie", true));
    public final BooleanSetting chat = add(new BooleanSetting("Chat Message", "Wiadomość na czacie (widzisz ją tylko Ty)", false));
    public final BooleanSetting self = add(new BooleanSetting("Count Self", "Licz też swoje totemy", true));
    public final NumberSetting showFor = add(new NumberSetting("Show For", "Jak długo pokazywać gracza po ostatnim totemie", 60, 10, 600, 10, " s"));

    private static final class Entry {
        String name;
        int pops;
        long last;
    }

    private final Map<String, Entry> entries = new LinkedHashMap<String, Entry>();
    private boolean wasInGame;
    private ItemInfo icon;

    public TotemPopHud() {
        super("Totem Pops", "Licznik zużytych totemów graczy w pobliżu", 0.0f, 0.36f);
        width = 100;
        height = 30;
    }

    @Override
    protected boolean needsHook() { return true; }

    public void onStatus(Object entity, int status) {
        if (status != 35 && status != 3) return;
        TargetInfo t = game().describe(entity);
        if (t == null || !t.player || t.name == null) return;
        boolean me = t.name.equals(game().username());
        if (me && !self.isOn()) return;
        String key = t.name;
        if (status == 3) {
            Entry e = entries.remove(key);
            if (e != null && notify.isOn()) NotificationManager.push("Totem Pops", (me ? "Zginąłeś" : t.name + " zginął") + " po " + e.pops + " " + totems(e.pops), NotificationManager.Type.INFO);
            return;
        }
        Entry e = entries.get(key);
        if (e == null) {
            e = new Entry();
            e.name = me ? "Ty" : t.name;
            entries.put(key, e);
        }
        e.pops++;
        e.last = System.currentTimeMillis();
        String msg = (me ? "Zużyłeś" : t.name + " zużył") + " totem (" + e.pops + ")";
        if (notify.isOn()) NotificationManager.push("Totem Pops", msg, NotificationManager.Type.WARNING);
        if (chat.isOn()) game().localChat("§6[Totem] §f" + msg);
    }

    private static String totems(int n) {
        return n == 1 ? "totemie" : "totemach";
    }

    @Override
    public void onTick() {
        boolean in = inGame();
        if (!in && wasInGame) entries.clear();
        wasInGame = in;
    }

    private List<Entry> recent() {
        long now = System.currentTimeMillis();
        List<Entry> out = new ArrayList<Entry>();
        for (Entry e : entries.values()) if (now - e.last < showFor.get() * 1000) out.add(e);
        Collections.sort(out, new Comparator<Entry>() {
            @Override public int compare(Entry a, Entry b) { return Long.compare(b.last, a.last); }
        });
        return out.size() > 6 ? out.subList(0, 6) : out;
    }

    @Override
    public boolean shouldRender() { return !recent().isEmpty(); }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        List<Entry> list = recent();
        if (list.isEmpty()) {
            list = new ArrayList<Entry>();
            String[] names = {"Notch", "jeb_", "Ty"};
            int[] pops = {3, 1, 2};
            for (int i = 0; i < names.length; i++) {
                Entry e = new Entry();
                e.name = names[i];
                e.pops = pops[i];
                e.last = System.currentTimeMillis() - i * 4000L;
                list.add(e);
            }
        }
        if (icon == null) icon = game().itemIcon("minecraft:totem_of_undying");
        float w = Render2D.textWidth("Totemy") + 30;
        for (Entry e : list) w = Math.max(w, Render2D.textWidth(e.name) + Render2D.textWidth("×" + e.pops) + 22);
        width = w;
        height = 18 + list.size() * 11 + 3;
        Render2D.roundedRect(g, 0, 0, width, height, Theme.radius() * 0.8f, 0x90160F26);
        Render2D.roundedRect(g, 0, 3, 2, 12, 1, Theme.accent());
        if (icon != null) {
            g.push();
            g.translate(4, 1);
            g.scale(0.9f, 0.9f);
            g.item(icon, 0, 0, false);
            g.pop();
        }
        Render2D.text(g, "Totemy", 21, 5, Theme.accent(), true);
        long now = System.currentTimeMillis();
        float y = 18;
        for (Entry e : list) {
            float fresh = Math.max(0, 1 - (now - e.last) / 1500f);
            int nameCol = ColorUtil.lerp(0xFFFFFFFF, 0xFFFFC447, fresh);
            Render2D.text(g, e.name, 6, y, nameCol, true);
            String c = "×" + e.pops;
            int cc = e.pops >= 3 ? 0xFFFF5C5C : e.pops == 2 ? 0xFFFFC447 : 0xFF9EF0B5;
            Render2D.text(g, c, width - 5 - Render2D.textWidth(c), y, cc, true);
            y += 11;
        }
    }
}
