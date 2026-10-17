package dev.noreclient.module.player;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * One-click crafting of basic items from a panel next to the inventory or crafting table.
 * Missing intermediate items (planks, sticks) are crafted first. Uses the recipe book when the
 * recipe is unlocked and normal slot clicks otherwise, so it works on any server.
 */
public class AutoCraft extends Module {
    public final ModeSetting side = add(new ModeSetting("Panel Side", "Po której stronie ekwipunku pokazać panel", "Right", "Right", "Left"));
    public final BooleanSetting smartChain = add(new BooleanSetting("Craft Ingredients", "Najpierw zrób brakujące deski i patyki", true));
    public final BooleanSetting showUnavailable = add(new BooleanSetting("Show Unavailable", "Pokazuj też przepisy bez składników", true));
    public final NumberSetting delay = add(new NumberSetting("Delay", "Odstęp między krokami (ticki)", 2, 1, 10, 1, "t"));
    public final BooleanSetting notify = add(new BooleanSetting("Notify", "Powiadomienie po skończeniu", true));

    /** A craftable entry; {@code ids} are alternative recipe ids (e.g. every planks type). */
    public static final class Recipe {
        final String name;
        final String icon;
        final String[] ids;
        final String[] needs;
        final boolean bigGrid;

        Recipe(String name, String icon, String[] ids, String[] needs, boolean bigGrid) {
            this.name = name;
            this.icon = icon;
            this.ids = ids;
            this.needs = needs;
            this.bigGrid = bigGrid;
        }
    }

    private static final String[] NONE = new String[0];
    private static final String[] WOOD = {"oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "crimson", "warped"};
    private static final List<Recipe> RECIPES = new ArrayList<Recipe>();
    private static final Map<String, Recipe> BY_KEY = new HashMap<String, Recipe>();

    private static void recipe(String key, String name, String icon, String[] ids, String[] needs, boolean big) {
        Recipe r = new Recipe(name, icon, ids, needs, big);
        RECIPES.add(r);
        BY_KEY.put(key, r);
    }

    static {
        String[] planks = new String[WOOD.length + 1];
        for (int i = 0; i < WOOD.length; i++) planks[i] = WOOD[i] + "_planks";
        planks[WOOD.length] = "bamboo_planks";
        String[] p = {"planks"}, s = {"sticks"}, ps = {"planks", "sticks"};
        recipe("planks", "Deski", "minecraft:oak_planks", planks, NONE, false);
        recipe("sticks", "Patyki", "minecraft:stick", new String[]{"stick", "stick_from_bamboo_item"}, p, false);
        recipe("table", "Stół rzemieślniczy", "minecraft:crafting_table", new String[]{"crafting_table"}, p, false);
        recipe("torch", "Pochodnie", "minecraft:torch", new String[]{"torch"}, s, false);
        recipe("chest", "Skrzynia", "minecraft:chest", new String[]{"chest"}, p, true);
        recipe("furnace", "Piec", "minecraft:furnace", new String[]{"furnace"}, NONE, true);
        recipe("ladder", "Drabina", "minecraft:ladder", new String[]{"ladder"}, s, true);
        recipe("wpick", "Drewniany kilof", "minecraft:wooden_pickaxe", new String[]{"wooden_pickaxe"}, ps, true);
        recipe("spick", "Kamienny kilof", "minecraft:stone_pickaxe", new String[]{"stone_pickaxe"}, s, true);
        recipe("saxe", "Kamienna siekiera", "minecraft:stone_axe", new String[]{"stone_axe"}, s, true);
        recipe("ssword", "Kamienny miecz", "minecraft:stone_sword", new String[]{"stone_sword"}, s, true);
        recipe("shovel", "Kamienna łopata", "minecraft:stone_shovel", new String[]{"stone_shovel"}, s, true);
        recipe("bread", "Chleb", "minecraft:bread", new String[]{"bread"}, NONE, true);
        recipe("bowl", "Miska", "minecraft:bowl", new String[]{"bowl"}, p, true);
        recipe("door", "Drzwi", "minecraft:oak_door", woodIds("_door"), p, true);
    }

    private static String[] woodIds(String suffix) {
        String[] out = new String[WOOD.length];
        for (int i = 0; i < WOOD.length; i++) out[i] = WOOD[i] + suffix;
        return out;
    }

    // ------------------------------------------------------------------ state
    private final Map<Recipe, Integer> direct = new HashMap<Recipe, Integer>();
    private final Map<Recipe, String> bestId = new HashMap<Recipe, String>();
    private final Map<Object, Animation> hover = new HashMap<Object, Animation>();
    private int refresh;

    private Recipe job;
    private boolean jobAll;
    private int wait, steps, crafted, resultWait;
    private boolean waitingResult;

    // last panel layout (for clicks)
    private float px, py, pw;
    private final List<Recipe> shown = new ArrayList<Recipe>();
    private static final float ROW = 17, HEAD = 18;

    public AutoCraft() {
        super("Auto Craft", "Szybkie craftowanie podstawowych rzeczy jednym kliknięciem", Category.PLAYER);
        setEnabled(true);
    }

    @Override
    protected boolean needsHook() { return true; }

    @Override
    protected boolean showsToggleNotification() { return true; }

    private int grid() { return game().craftingGrid(); }

    private boolean fits(Recipe r) { return !r.bigGrid || grid() >= 3; }

    private void recompute() {
        direct.clear();
        bestId.clear();
        for (Recipe r : RECIPES) {
            int best = 0;
            String id = null;
            if (fits(r)) {
                for (String candidate : r.ids) {
                    int c = game().craftableCount(candidate);
                    if (c > best) { best = c; id = candidate; }
                }
            }
            direct.put(r, best);
            if (id != null) bestId.put(r, id);
        }
    }

    /** Whether the recipe can be made now, possibly after crafting its ingredients. */
    private boolean available(Recipe r, int depth) {
        if (!fits(r)) return false;
        Integer d = direct.get(r);
        if (d != null && d > 0) return true;
        if (!smartChain.isOn() || depth > 2 || r.needs.length == 0) return false;
        for (String n : r.needs) {
            Recipe need = BY_KEY.get(n);
            if (need != null && available(need, depth + 1)) return true;
        }
        return false;
    }

    /** The recipe to craft next on the way to {@code r}, or null when nothing can be done. */
    private Recipe nextStep(Recipe r, int depth) {
        Integer d = direct.get(r);
        if (d != null && d > 0) return r;
        if (!smartChain.isOn() || depth > 2) return null;
        for (String n : r.needs) {
            Recipe need = BY_KEY.get(n);
            if (need == null) continue;
            Recipe step = nextStep(need, depth + 1);
            if (step != null) return step;
        }
        return null;
    }

    @Override
    public void onTick() {
        if (grid() == 0) {
            if (job != null) finish(false);
            return;
        }
        if (job == null) {
            if (refresh-- <= 0) {
                recompute();
                refresh = 5;
            }
            return;
        }
        if (wait > 0) {
            wait--;
            return;
        }
        if (waitingResult) {
            // the server fills the result slot a moment later; wait for it (max ~1.5 s)
            if (game().craftResultReady()) {
                waitingResult = false;
                game().takeCraftResult();
                wait = delay.intValue();
                return;
            }
            if (++resultWait > 30) finish(crafted > 1);
            return;
        }
        recompute();
        if (steps++ > 80) {
            finish(true);
            return;
        }
        Recipe step = nextStep(job, 0);
        if (step == null) {
            finish(crafted > 0);
            return;
        }
        boolean isTarget = step == job;
        if (isTarget && crafted > 0 && !jobAll) {
            finish(true);
            return;
        }
        String id = bestId.get(step);
        if (id == null || !game().fillRecipe(id, isTarget && jobAll)) {
            finish(crafted > 0);
            return;
        }
        if (isTarget) crafted++;
        waitingResult = true;
        resultWait = 0;
        wait = delay.intValue();
    }

    private void finish(boolean ok) {
        if (notify.isOn() && job != null) {
            if (ok) NotificationManager.push("Auto Craft", job.name + " ✔", NotificationManager.Type.SUCCESS);
            else if (crafted == 0) NotificationManager.push("Auto Craft", "Brak składników: " + job.name, NotificationManager.Type.WARNING);
        }
        job = null;
        waitingResult = false;
        wait = 0;
        refresh = 0;
    }

    private void start(Recipe r, boolean all) {
        if (job != null) return;
        if (!available(r, 0)) {
            NotificationManager.push("Auto Craft", "Brak składników: " + r.name, NotificationManager.Type.WARNING);
            return;
        }
        job = r;
        jobAll = all;
        steps = 0;
        crafted = 0;
        wait = 0;
        Sounds.click();
    }

    // ------------------------------------------------------------------ panel

    private Animation anim(Object key) {
        Animation a = hover.get(key);
        if (a == null) {
            a = new Animation(0, 14);
            hover.put(key, a);
        }
        return a;
    }

    /** Draws the panel next to the open inventory / crafting table. */
    public void renderPanel(Gfx g, int left, int top, int bgWidth, int bgHeight, int screenW, int mx, int my) {
        if (!isActive() || grid() == 0) return;
        CurrentGfx.set(g);
        if (direct.isEmpty()) recompute();
        shown.clear();
        for (Recipe r : RECIPES) {
            if (!fits(r)) continue;
            if (!showUnavailable.isOn() && !available(r, 0)) continue;
            shown.add(r);
        }
        pw = 118;
        float ph = HEAD + shown.size() * ROW + 16;
        px = side.is("Left") ? left - pw - 6 : left + bgWidth + 6;
        if (px + pw > screenW - 2) px = left - pw - 6;
        if (px < 2) px = 2;
        py = top;
        float r = Theme.radius();
        Render2D.shadow(g, px, py, pw, ph, r, 8, 0x90000000);
        Render2D.roundedRect(g, px, py, pw, ph, r, 0xF0120E0B);
        Render2D.roundedOutline(g, px, py, pw, ph, r, 1, ColorUtil.withAlpha(Theme.accent(), 110));
        Render2D.quadGradient(g, px + 6, py + HEAD - 2, pw - 12, 1, ColorUtil.withAlpha(Theme.accent(), 200), ColorUtil.withAlpha(Theme.accent(), 0), ColorUtil.withAlpha(Theme.accent(), 0), ColorUtil.withAlpha(Theme.accent(), 200));
        Render2D.gradientText(g, "Auto Craft", px + 7, py + 5, 1f, Theme.accent2(), Theme.accent(), false);
        if (job != null) {
            float a = (System.currentTimeMillis() % 900) / 900f * 360;
            Render2D.ring(g, px + pw - 10, py + 9, 4, 1.4f, a, a + 260, Theme.accent());
        } else {
            String gs = grid() + "×" + grid();
            Render2D.scaledText(g, gs, px + pw - 7 - Render2D.textWidth(gs) * 0.75f, py + 6, 0.75f, Theme.TEXT_MUTED, false);
        }
        float y = py + HEAD;
        for (Recipe rc : shown) {
            boolean can = available(rc, 0);
            Integer d = direct.get(rc);
            int count = d == null ? 0 : d;
            boolean hov = can && job == null && Render2D.hovered(mx, my, px + 3, y, pw - 6, ROW - 1);
            float ha = anim(rc).target(hov ? 1 : 0).update();
            boolean active = job == rc;
            if (active) Render2D.roundedRect(g, px + 3, y, pw - 6, ROW - 1, r * 0.7f, ColorUtil.withAlpha(Theme.accent(), 70));
            else if (ha > 0.01f) Render2D.roundedRect(g, px + 3, y, pw - 6, ROW - 1, r * 0.7f, ColorUtil.withAlpha(Theme.accent(), (int) (45 * ha)));
            String iconId = rc.icon;
            String best = bestId.get(rc);
            if (best != null && !best.startsWith("stick")) iconId = "minecraft:" + best;
            ItemInfo icon = game().itemIcon(iconId);
            if (icon != null) {
                g.push();
                g.translate(px + 6, y + 1.5f);
                g.scale(0.85f, 0.85f);
                g.setAlpha(can ? 1f : 0.35f);
                g.item(icon, 0, 0, false);
                g.setAlpha(1f);
                g.pop();
            }
            int tc = can ? ColorUtil.lerp(Theme.TEXT, 0xFFFFFFFF, ha) : Theme.TEXT_MUTED;
            Render2D.text(g, Render2D.trim(rc.name, (int) pw - 46), px + 22 + ha * 1.5f, y + 4.5f, tc, false);
            String badge = count > 0 ? "×" + Math.min(count, 999) : can ? "↻" : "";
            if (!badge.isEmpty()) {
                int bc = count > 0 ? Theme.accent() : Theme.TEXT_DIM;
                Render2D.scaledText(g, badge, px + pw - 7 - Render2D.textWidth(badge) * 0.8f, y + 5f, 0.8f, bc, false);
            }
            y += ROW;
        }
        Render2D.scaledText(g, "LPM: 1 • Shift+LPM: wszystko", px + 7, y + 4, 0.65f, Theme.TEXT_MUTED, false);
    }

    /** Returns true when the click hit the panel. */
    public boolean click(double mx, double my, int button) {
        if (!isActive() || grid() == 0 || shown.isEmpty()) return false;
        float ph = HEAD + shown.size() * ROW + 16;
        if (!Render2D.hovered(mx, my, px, py, pw, ph)) return false;
        if (button != 0) return true;
        int idx = (int) ((my - py - HEAD) / ROW);
        if (my >= py + HEAD && idx >= 0 && idx < shown.size()) start(shown.get(idx), game().shiftDown());
        return true;
    }
}
