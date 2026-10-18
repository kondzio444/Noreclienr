package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** "+12 Cobblestone" lines for items that land in your inventory, merged per item and fading out. */
public class PickupLogHud extends HudModule {
    public final NumberSetting duration = add(new NumberSetting("Duration", "Jak długo widać wpis", 4, 1, 15, 0.5, " s"));
    public final NumberSetting rows = add(new NumberSetting("Rows", "Najwięcej wpisów naraz", 5, 1, 10, 1));

    private static final class Entry {
        ItemInfo item;
        String name;
        int amount;
        long at;
    }

    private final List<Entry> entries = new ArrayList<Entry>();
    private Map<String, Integer> baseline;
    private final Map<String, ItemInfo> sample = new HashMap<String, ItemInfo>();

    public PickupLogHud() {
        super("Pickup Log", "Lista podniesionych przedmiotów (+12 Bruk)", 0.98f, 0.55f);
        width = 90;
        height = 40;
    }

    private Map<String, Integer> counts() {
        Map<String, Integer> out = new HashMap<String, Integer>();
        sample.clear();
        for (ItemInfo i : game().inventory()) {
            if (i == null || i.id == null || i.count <= 0) continue;
            Integer c = out.get(i.id);
            out.put(i.id, (c == null ? 0 : c) + i.count);
            if (!sample.containsKey(i.id)) sample.put(i.id, i);
        }
        return out;
    }

    @Override
    public void onTick() {
        if (!inGame() || game().dead()) { baseline = null; return; }
        // moving items around in a screen is not picking them up: start counting again afterwards
        if (game().screenOpen() && !game().chatOpen()) { baseline = null; return; }
        Map<String, Integer> now = counts();
        if (baseline != null) {
            long t = System.currentTimeMillis();
            for (Map.Entry<String, Integer> e : now.entrySet()) {
                Integer before = baseline.get(e.getKey());
                int gain = e.getValue() - (before == null ? 0 : before);
                if (gain > 0) add(e.getKey(), gain, t);
            }
        }
        baseline = now;
        long cut = System.currentTimeMillis() - (long) (duration.get() * 1000);
        for (int i = entries.size() - 1; i >= 0; i--) if (entries.get(i).at < cut) entries.remove(i);
    }

    private void add(String id, int gain, long t) {
        for (Entry e : entries) {
            if (e.item.id.equals(id)) {
                e.amount += gain;
                e.at = t;
                entries.remove(e);
                entries.add(0, e);
                return;
            }
        }
        Entry e = new Entry();
        e.item = sample.get(id);
        e.name = game().itemName(e.item);
        e.amount = gain;
        e.at = t;
        entries.add(0, e);
        while (entries.size() > 12) entries.remove(entries.size() - 1);
    }

    @Override
    public boolean shouldRender() { return !entries.isEmpty(); }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        List<Entry> list = entries;
        long now = System.currentTimeMillis();
        if (list.isEmpty()) {
            list = new ArrayList<Entry>();
            String[][] demo = {{"minecraft:cobblestone", "Bruk", "23"}, {"minecraft:oak_log", "Kłoda dębowa", "4"}, {"minecraft:diamond", "Diament", "2"}};
            for (String[] d : demo) {
                Entry e = new Entry();
                e.item = game().itemIcon(d[0]);
                e.name = d[1];
                e.amount = Integer.parseInt(d[2]);
                e.at = now;
                list.add(e);
            }
        }
        int max = Math.min(list.size(), rows.intValue());
        float w = 60;
        for (int i = 0; i < max; i++) w = Math.max(w, Render2D.textWidth("+" + list.get(i).amount + " " + list.get(i).name) + 24);
        width = w;
        height = max * 17;
        boolean right = rightAligned();
        float life = (float) (duration.get() * 1000);
        for (int i = 0; i < max; i++) {
            Entry e = list.get(i);
            float age = now - e.at;
            float a = Math.max(0, Math.min(1, (life - age) / 500f));
            float slide = Math.max(0, 1 - age / 180f);
            String t = "+" + e.amount + " " + e.name;
            float rw = Render2D.textWidth(t) + 24;
            float x = right ? width - rw : 0;
            x += (right ? 1 : -1) * slide * 10;
            float y = i * 17;
            g.setAlpha(a);
            Render2D.roundedRect(g, x, y, rw, 15, Theme.radius() * 0.7f, 0x90160F26);
            if (e.item != null) {
                g.push();
                g.translate(x + 2, y + 0.5f);
                g.scale(0.85f, 0.85f);
                g.item(e.item, 0, 0, false);
                g.pop();
            }
            Render2D.text(g, "+" + e.amount, x + 19, y + 4, ColorUtil.brighten(Theme.accent(), 0.2f), true);
            Render2D.text(g, e.name, x + 19 + Render2D.textWidth("+" + e.amount + " "), y + 4, 0xFFFFFFFF, true);
            g.setAlpha(1);
        }
    }
}
