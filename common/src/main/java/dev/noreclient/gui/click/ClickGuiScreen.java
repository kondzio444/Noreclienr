package dev.noreclient.gui.click;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.NoreClient;
import dev.noreclient.config.ConfigManager;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.gui.widget.TextBox;
import dev.noreclient.gui.widget.Widgets;
import dev.noreclient.module.Category;
import dev.noreclient.module.ExtraModules;
import dev.noreclient.module.Module;
import dev.noreclient.module.client.ClickGuiModule;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.setting.Setting;
import dev.noreclient.setting.StringSetting;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.MenuBackground;
import dev.noreclient.util.Modrinth;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The main client menu: category sidebar, searchable module cards, a full settings editor
 * (switches, sliders, mode pickers, colour pickers, keybinds) and a profile manager.
 *
 * <p>Implemented as an immediate-mode GUI: every frame the layout is drawn and clickable regions
 * are recorded; mouse events are matched against the regions recorded in the last frame.
 */
public class ClickGuiScreen extends NoreScreen {
    private static final float W = 540, H = 330, SIDEBAR = 132;

    private enum Page { MODULES, SETTINGS, PROFILES, DOWNLOADS }

    private interface ClickAction { void click(double mx, double my, int button); }

    private interface DragAction { void drag(double mx, double my); }

    private static final class Hit {
        final float x, y, w, h;
        final boolean clipped;
        final ClickAction action;

        Hit(float x, float y, float w, float h, boolean clipped, ClickAction action) {
            this.x = x; this.y = y; this.w = w; this.h = h; this.clipped = clipped; this.action = action;
        }
    }

    // remember the last tab and view between openings
    private static Category lastCategory = null;
    private static int lastCollection = 0;
    private static boolean listView = false;

    /** 0 = category filter, 1 = favourites, 2 = new modules. */
    private int collection = lastCollection;
    private float activeNavY = -1;

    private interface IconDraw { void draw(float cx, float cy, int color); }

    private final List<Hit> hits = new ArrayList<>();
    private final Map<Object, Animation> anims = new HashMap<>();
    private final TextBox search = new TextBox("Szukaj modułów...", 32);
    private final TextBox profileName = new TextBox("Nazwa profilu", 24);
    private final Map<StringSetting, TextBox> stringBoxes = new HashMap<>();
    private final TextBox dlSearch = new TextBox("Szukaj paczek zasobów...", 40);
    private final List<Modrinth.Hit> dlResults = new ArrayList<>();
    private final Map<String, String> dlState = new HashMap<>();
    private String dlQuery = null, dlError = null, dlSort = "relevance", dlCategory = "";
    private boolean dlLoading, dlMore, dlInstalledTab;
    private int dlTotal;
    private long dlTyped;
    private int dlRequest;
    private final Animation dlTab = new Animation(0, 16);
    private List<java.io.File> dlLocal;
    private final Animation open = new Animation(0, 10);
    private final Animation scroll = new Animation(0, 16);
    private final Animation pageAnim = new Animation(1, 12);

    private Page page = Page.MODULES;
    private Category category = lastCategory;
    private Module selected;
    private boolean closing;
    private float contentHeight;
    private DragAction drag;
    private KeybindSetting listening;
    private ColorSetting expandedColor;
    private float[] pickerHsb = new float[3];
    private long resetConfirm;

    private float alpha = 1;
    private long pageSwitch = System.currentTimeMillis();
    private String lastSearch = "";
    private final Animation navY = new Animation(61, 16);
    private final Animation navAlpha = new Animation(0, 12);

    // per-frame transform
    private float scale, ox, oy;
    private float clipX, clipY, clipW, clipH;

    public ClickGuiScreen(Object parent) {
        super(parent);
    }

    /** Opens the menu directly on the settings page of the given module. */
    public static ClickGuiScreen forModule(Object parent, Module m) {
        ClickGuiScreen s = new ClickGuiScreen(parent);
        s.page = Page.SETTINGS;
        s.selected = m;
        s.category = m.getCategory();
        return s;
    }

    /** Opens the menu on the Modrinth downloads page. */
    public static ClickGuiScreen forDownloads(Object parent) {
        ClickGuiScreen s = new ClickGuiScreen(parent);
        s.page = Page.DOWNLOADS;
        return s;
    }

    private Animation anim(Object key, float speed) {
        return anims.computeIfAbsent(key, k -> new Animation(0, speed));
    }

    private ClickGuiModule guiModule() {
        return NoreClient.get().modules().get(ClickGuiModule.class);
    }

    @Override
    public boolean pausesGame() { return false; }

    // ------------------------------------------------------------------ navigation

    private void switchPage(Page p, Module m) {
        page = p;
        selected = m;
        expandedColor = null;
        listening = null;
        scroll.set(0);
        pageAnim.set(0);
        pageAnim.target(1);
        pageSwitch = System.currentTimeMillis();
        Sounds.click();
    }

    @Override
    public void close() {
        if (closing) return;
        closing = true;
        open.target(0);
        search.setFocused(false);
        NoreClient.get().config().save();
    }

    // ------------------------------------------------------------------ input mapping

    private double mapX(double mx) { return mx / scale - ox; }

    private double mapY(double my) { return my / scale - oy; }

    private boolean inClip(double x, double y) {
        return x >= clipX && y >= clipY && x < clipX + clipW && y < clipY + clipH;
    }

    private void hit(float x, float y, float w, float h, boolean clipped, ClickAction a) {
        hits.add(new Hit(x, y, w, h, clipped, a));
    }

    private boolean hovered(double mx, double my, float x, float y, float w, float h, boolean clipped) {
        return Render2D.hovered(mx, my, x, y, w, h) && (!clipped || inClip(mx, my));
    }

    // ------------------------------------------------------------------ rendering

    @Override
    public Background background() { return game().inWorld() ? Background.DIM_WORLD : Background.NONE; }

    private void renderBackground(Gfx context, int mouseX, int mouseY, float delta) {
        if (!game().inWorld()) {
            MenuBackground.render(context, width, height, mouseX, mouseY);
            Render2D.rect(context, 0, 0, width, height, 0x60000000);
        }
    }

    @Override
    public void render(Gfx ctx, int mouseX, int mouseY, float delta) {
        float o = open.target(closing ? 0 : 1).update();
        if (!guiModule().openAnimation.isOn() && !closing) open.set(1);
        if (closing && o < 0.02f) {
            game().openParent(parent);
            return;
        }
        renderBackground(ctx, mouseX, mouseY, delta);

        float base = Math.min(guiModule().guiScale.floatValue(), Math.min((width - 16) / W, (height - 16) / H));
        float eased = Animation.easeOutBack(o);
        scale = base * (0.88f + 0.12f * eased);
        ox = (width / scale - W) / 2f;
        oy = (height / scale - H) / 2f + (1 - Animation.easeOutCubic(o)) * 12;
        double mx = mapX(mouseX), my = mapY(mouseY);

        hits.clear();
        alpha = Animation.easeOutCubic(o);
        ctx.setAlpha(alpha);
        ctx.push();
        ctx.scale(scale, scale);
        ctx.translate(ox, oy);

        float r = Theme.radius() * 1.4f;
        Render2D.shadow(ctx, 0, 0, W, H, r, 10, ColorUtil.fade(0xB0000000, o));
        Render2D.roundedRect(ctx, 0, 0, W, H, r, Theme.BG);
        // soft accent light across the top of the content area
        Render2D.quadGradient(ctx, SIDEBAR + 1, 0, W - SIDEBAR - r, 70, ColorUtil.withAlpha(Theme.accent(), 26), ColorUtil.withAlpha(Theme.accent2(), 14), 0, 0);
        Render2D.quadGradient(ctx, SIDEBAR + 20, 0, (W - SIDEBAR - 40) / 2f, 1, 0, Theme.accent(), Theme.accent(), 0);
        Render2D.quadGradient(ctx, SIDEBAR + 20 + (W - SIDEBAR - 40) / 2f, 0, (W - SIDEBAR - 40) / 2f, 1, Theme.accent2(), 0, 0, Theme.accent2());
        renderSidebar(ctx, mx, my);
        renderHeader(ctx, mx, my);

        clipX = SIDEBAR + 10;
        clipY = 46;
        clipW = W - SIDEBAR - 20;
        clipH = H - 56;
        scroll.update();
        float pa = Animation.easeOutCubic(pageAnim.update());
        enableClip(ctx);
        ctx.push();
        ctx.translate(0, -scroll.get() + (1 - pa) * 10);
        double cmy = my + scroll.get() - (1 - pa) * 10;
        ctx.setAlpha(alpha * pa);
        switch (page) {
            case MODULES: renderModules(ctx, mx, cmy); break;
            case SETTINGS: renderSettings(ctx, mx, cmy); break;
            case PROFILES: renderProfiles(ctx, mx, cmy); break;
            default: renderDownloads(ctx, mx, cmy); break;
        }
        ctx.pop();
        ctx.endScissor();
        ctx.setAlpha(alpha);
        renderScrollbar(ctx);
        Render2D.roundedOutline(ctx, 0, 0, W, H, r, 1, Theme.OUTLINE);
        ctx.pop();
        ctx.setAlpha(1);

        if (drag != null) drag.drag(mx, cmyForDrag(my));
        NotificationManager.render(ctx);
    }

    private double cmyForDrag(double my) {
        return my + scroll.get();
    }

    private void enableClip(Gfx ctx) {
        int x1 = (int) Math.floor((clipX + ox) * scale), y1 = (int) Math.floor((clipY + oy) * scale);
        int x2 = (int) Math.ceil((clipX + clipW + ox) * scale), y2 = (int) Math.ceil((clipY + clipH + oy) * scale);
        ctx.scissor(x1, y1, x2, y2);
    }

    private void renderScrollbar(Gfx ctx) {
        if (contentHeight <= clipH) return;
        float trackH = clipH - 8;
        float barH = Math.max(20, trackH * clipH / contentHeight);
        float maxScroll = contentHeight - clipH;
        float y = clipY + 4 + (trackH - barH) * (scroll.get() / maxScroll);
        Render2D.roundedRect(ctx, W - 7, y, 3, barH, 1.5f, ColorUtil.withAlpha(Theme.accent(), 150));
    }

    private void renderSidebar(Gfx ctx, double mx, double my) {
        float r = Theme.radius() * 1.4f;
        Render2D.roundedRect(ctx, 0, 0, SIDEBAR, H, r, Theme.SIDEBAR);
        Render2D.rect(ctx, SIDEBAR - r, 0, r, H, Theme.SIDEBAR);
        Render2D.rect(ctx, SIDEBAR, 0, 1, H, Theme.OUTLINE);

        // logo with a soft accent glow
        Render2D.radial(ctx, 25, 22, 34, ColorUtil.withAlpha(Theme.accent(), 60), ColorUtil.withAlpha(Theme.accent(), 0));
        Render2D.logo(ctx, 9, 7, 30, 1f);
        Render2D.gradientText(ctx, "Nore", 43, 11, 1.35f, Theme.accent2(), Theme.accent(), false);
        Render2D.scaledText(ctx, "CLIENT " + NoreClient.VERSION, 43, 25, 0.7f, Theme.TEXT_MUTED, false);

        // sliding highlight under the active entry (position from the last frame)
        float na = navAlpha.target(activeNavY >= 0 ? 1 : 0).update();
        if (activeNavY >= 0) {
            if (navAlpha.get() < 0.05f) navY.set(activeNavY);
            navY.target(activeNavY);
        }
        float ny = navY.update();
        if (na > 0.01f) {
            Widgets.glowBox(ctx, 8, ny, SIDEBAR - 16, 19, Theme.radius(), Theme.accent(), 0.15f, na);
            Render2D.roundedRect(ctx, 8, ny + 4.5f, 2.5f, 10, 1.25f, ColorUtil.fade(Theme.accent(), na));
        }
        activeNavY = -1;

        float y = 46;
        y = section(ctx, "MODUŁY", y);
        List<Module> all = NoreClient.get().modules().getModules();
        y = navEntry(ctx, mx, my, y, page == Page.MODULES && collection == 0 && category == null, "Wszystkie",
                (cx, cy, c) -> Icons.grid(ctx, cx, cy, 9, c), countOn(all), () -> openCollection(0, null));
        for (Category c : Category.values()) {
            List<Module> mods = NoreClient.get().modules().getModules(c);
            boolean active = (page == Page.MODULES && collection == 0 || page == Page.SETTINGS && selected != null) && category == c;
            y = navEntry(ctx, mx, my, y, active, c.displayName, (cx, cy, col) -> Icons.category(ctx, c, cx, cy, 9, active ? c.color : col),
                    countOn(mods), () -> openCollection(0, c));
        }
        y = section(ctx, "KOLEKCJE", y + 3);
        int favs = 0, news = 0;
        for (Module m : all) {
            if (m.isFavorite()) favs++;
            if (ExtraModules.isNew(m)) news++;
        }
        y = navEntry(ctx, mx, my, y, page == Page.MODULES && collection == 1, "Ulubione",
                (cx, cy, c) -> Icons.star(ctx, cx, cy, 4.8f, collection == 1 ? Theme.WARNING : c, true), favs > 0 ? String.valueOf(favs) : "", () -> openCollection(1, null));
        y = navEntry(ctx, mx, my, y, page == Page.MODULES && collection == 2, "Nowe",
                (cx, cy, c) -> Icons.sparkle(ctx, cx, cy, 5, collection == 2 ? Theme.accent2() : c), String.valueOf(news), () -> openCollection(2, null));
        y = section(ctx, "ZASOBY", y + 3);
        navEntry(ctx, mx, my, y, page == Page.DOWNLOADS, "Paczki zasobów",
                (cx, cy, c) -> Icons.download(ctx, cx, cy, 9, c), "", () -> switchPage(Page.DOWNLOADS, null));

        // bottom buttons
        float bw = SIDEBAR - 24;
        float by = H - 52;
        boolean hp = Render2D.hovered(mx, my, 12, by, bw, 20);
        Widgets.button(ctx, 12, by, bw, 20, "✎ Edytuj HUD", anim("btn_hud", 14).target(hp ? 1 : 0).update(), true);
        hit(12, by, bw, 20, false, (x, yy, b) -> {
            Sounds.click();
            game().openScreen(new HudEditorScreen(this));
        });
        by += 24;
        boolean pp = Render2D.hovered(mx, my, 12, by, bw, 20) || page == Page.PROFILES;
        Widgets.button(ctx, 12, by, bw, 20, "☰ Profile", anim("btn_prof", 14).target(pp ? 1 : 0).update(), false);
        hit(12, by, bw, 20, false, (x, yy, b) -> switchPage(Page.PROFILES, null));
    }

    private float section(Gfx ctx, String label, float y) {
        Render2D.scaledText(ctx, label, 14, y, 0.65f, Theme.TEXT_MUTED, false);
        return y + 8;
    }

    private static String countOn(List<Module> mods) {
        int on = 0;
        for (Module m : mods) if (m.isEnabled() && m.isToggleable()) on++;
        return String.valueOf(on);
    }

    private void openCollection(int coll, Category c) {
        collection = coll;
        lastCollection = coll;
        category = c;
        lastCategory = c;
        search.setText("");
        switchPage(Page.MODULES, null);
    }

    private float navEntry(Gfx ctx, double mx, double my, float y, boolean active, String label, IconDraw icon, String count, Runnable action) {
        boolean hov = Render2D.hovered(mx, my, 8, y, SIDEBAR - 16, 19);
        float a = anim("nav_" + label, 14).target(active ? 1 : hov ? 0.6f : 0).update();
        if (active) activeNavY = y;
        if (hov && !active) Render2D.roundedRect(ctx, 8, y, SIDEBAR - 16, 19, Theme.radius(), 0x10FFFFFF);
        float shift = a * 2.5f;
        int ic = ColorUtil.lerp(Theme.TEXT_MUTED, active ? Theme.accent() : Theme.TEXT, Math.max(a, active ? 1 : 0));
        icon.draw(20 + shift, y + 9.5f, ic);
        Render2D.text(ctx, label, 31 + shift, y + 5.5f, ColorUtil.lerp(Theme.TEXT_DIM, Theme.TEXT, Math.max(a, active ? 1 : 0)));
        if (!count.isEmpty()) {
            boolean numeric = Character.isDigit(count.charAt(0));
            boolean lit = numeric && !count.equals("0");
            float sc = numeric ? 1f : 0.65f;
            float cw = Render2D.textWidth(count) * sc;
            if (lit) Render2D.roundedRect(ctx, SIDEBAR - 17 - cw, y + 4, cw + 6, 11, 5.5f, ColorUtil.withAlpha(Theme.accent(), 40));
            Render2D.scaledText(ctx, count, SIDEBAR - 14 - cw, y + (numeric ? 5.5f : 7f), sc, lit ? Theme.accent() : Theme.TEXT_MUTED, false);
        }
        hit(8, y, SIDEBAR - 16, 19, false, (x, yy, b) -> action.run());
        return y + 20;
    }

    private void renderHeader(Gfx ctx, double mx, double my) {
        float x = SIDEBAR + 12;
        String title, sub;
        if (page == Page.SETTINGS && selected != null) {
            boolean hb = Render2D.hovered(mx, my, x, 12, 20, 20);
            float ha = anim("back", 14).target(hb ? 1 : 0).update();
            Render2D.roundedRect(ctx, x, 12, 20, 20, Theme.radius(), ColorUtil.lerp(Theme.CARD, Theme.CARD_HOVER, ha));
            Render2D.centeredText(ctx, "←", x + 10, 18, ColorUtil.lerp(Theme.TEXT_DIM, Theme.TEXT, ha), false);
            hit(x, 12, 20, 20, false, (a, b, c) -> switchPage(Page.MODULES, null));
            x += 26;
            Icons.tile(ctx, selected.getCategory(), x, 11, 22, selected.isEnabled() ? 1 : 0);
            x += 28;
            title = selected.getName();
            sub = selected.getDescription();
            // favourite star in the header
            float sx = W - 24, sy = 22;
            boolean hs = Render2D.hovered(mx, my, sx - 9, sy - 9, 18, 18);
            float sa = anim("hstar", 14).target(hs ? 1 : 0).update();
            if (selected.isFavorite()) Icons.star(ctx, sx, sy, 6 + sa, Theme.WARNING, true);
            else Icons.star(ctx, sx, sy, 6 + sa, ColorUtil.lerp(Theme.TEXT_MUTED, Theme.WARNING, sa), false);
            Module m = selected;
            hit(sx - 9, sy - 9, 18, 18, false, (a, b, c) -> toggleFavorite(m));
        } else if (page == Page.DOWNLOADS) {
            title = "Paczki zasobów";
            sub = "Modrinth \u2022 Minecraft " + Modrinth.gameVersion() + " \u2022 włączysz jednym kliknięciem";
        } else if (page == Page.PROFILES) {
            title = "Profile";
            sub = "Zapisuj i wczytuj konfiguracje (aktywny: " + NoreClient.get().config().getActiveProfile() + ")";
        } else if (!search.getText().trim().isEmpty()) {
            title = "Wyniki wyszukiwania";
            sub = currentList().size() + " pasujących modułów";
        } else if (collection == 1) {
            title = "Ulubione";
            sub = currentList().isEmpty() ? "Kliknij gwiazdkę na module, aby go tu przypiąć" : currentList().size() + " przypiętych modułów";
        } else if (collection == 2) {
            title = "Nowe w " + NoreClient.VERSION;
            sub = "Auto Craft, Discord RPC, alerty, nowe nakładki i więcej";
        } else {
            title = category == null ? "Wszystkie moduły" : category.displayName;
            sub = category == null ? NoreClient.get().modules().getModules().size() + " modułów \u2022 " + NoreClient.get().modules().optionCount() + " opcji" : category.subtitle;
        }
        Render2D.scaledText(ctx, Render2D.trim(title, (int) ((W - x - 190) / 1.3f)), x, 12, 1.3f, Theme.TEXT, false);
        Render2D.text(ctx, Render2D.trim(sub, (int) (W - x - (page == Page.SETTINGS ? 40 : 190))), x, 26, Theme.TEXT_MUTED);
        if (page == Page.SETTINGS && selected != null && ExtraModules.isNew(selected)) {
            float tw = Render2D.textWidth(title) * 1.3f;
            newBadge(ctx, x + tw + 6, 13);
        }

        if (page == Page.DOWNLOADS) {
            float sw = 150, sx = W - sw - 12;
            dlSearch.render(ctx, sx, 12, sw, 22, TextBox.SEARCH_ICON);
            hit(sx, 12, sw, 22, false, (a, b, c) -> {
                dlSearch.setFocused(true);
                search.setFocused(false);
                profileName.setFocused(false);
            });
        }
        if (page == Page.MODULES) {
            float sw = 140, sx = W - sw - 40;
            search.render(ctx, sx, 12, sw, 22, TextBox.SEARCH_ICON);
            hit(sx, 12, sw, 22, false, (a, b, c) -> {
                search.setFocused(true);
                profileName.setFocused(false);
            });
            // grid / list toggle
            float vx = W - 34;
            boolean hv = Render2D.hovered(mx, my, vx, 12, 22, 22);
            float va = anim("view", 14).target(hv ? 1 : 0).update();
            Render2D.roundedRect(ctx, vx, 12, 22, 22, Theme.radius(), ColorUtil.lerp(Theme.CARD, Theme.CARD_HOVER, va));
            Render2D.roundedOutline(ctx, vx, 12, 22, 22, Theme.radius(), 1, ColorUtil.lerp(Theme.OUTLINE, ColorUtil.withAlpha(Theme.accent(), 180), va));
            int vc = ColorUtil.lerp(Theme.TEXT_DIM, Theme.accent(), va);
            if (listView) Icons.grid(ctx, vx + 11, 23, 10, vc);
            else for (int k = 0; k < 3; k++) {
                Render2D.rect(ctx, vx + 6, 18.5f + k * 4, 2, 2, vc);
                Render2D.rect(ctx, vx + 9.5f, 18.8f + k * 4, 7, 1.4f, vc);
            }
            hit(vx, 12, 22, 22, false, (a, b, c) -> {
                listView = !listView;
                pageSwitch = System.currentTimeMillis();
                scroll.set(0);
                Sounds.click();
            });
        }
    }

    private static void newBadge(Gfx ctx, float x, float y) {
        float w = Render2D.textWidth("NOWY") * 0.65f + 12;
        Widgets.glowBox(ctx, x, y, w, 10, 5, Theme.accent2(), 0, 0.8f);
        Icons.sparkle(ctx, x + 5, y + 5, 2.6f, 0xFFFFFFFF);
        Render2D.scaledText(ctx, "NOWY", x + 9, y + 2.8f, 0.65f, 0xFFFFFFFF, false);
    }

    private void toggleFavorite(Module m) {
        m.setFavorite(!m.isFavorite());
        Sounds.toggle(m.isFavorite());
        NoreClient.get().config().save();
    }

    private List<Module> currentList() {
        List<Module> all = NoreClient.get().modules().getModules();
        if (!search.getText().trim().isEmpty()) return NoreClient.get().modules().search(search.getText());
        List<Module> out = new ArrayList<>();
        if (collection == 1) { for (Module m : all) if (m.isFavorite()) out.add(m); return out; }
        if (collection == 2) { for (Module m : all) if (ExtraModules.isNew(m)) out.add(m); return out; }
        if (category == null) return all;
        return NoreClient.get().modules().getModules(category);
    }

    // ------------------------------------------------------------------ modules page

    private void renderModules(Gfx ctx, double mx, double my) {
        List<Module> list = currentList();
        int cols = listView ? 1 : 3;
        float gap = listView ? 5 : 8;
        float cw = (clipW - gap * (cols - 1)) / cols;
        float ch = listView ? 30 : guiModule().showDescriptions.isOn() ? 64 : 46;
        float startY = clipY + 2;
        if (list.isEmpty()) {
            String msg = !search.getText().trim().isEmpty() ? "Brak wyników dla \"" + search.getText() + "\""
                    : collection == 1 ? "Brak ulubionych – kliknij \u2606 na karcie modułu" : "Brak modułów";
            Render2D.centeredText(ctx, msg, clipX + clipW / 2f, clipY + 40, Theme.TEXT_MUTED, false);
        }
        if (!search.getText().equals(lastSearch)) {
            lastSearch = search.getText();
            pageSwitch = System.currentTimeMillis();
        }
        long since = System.currentTimeMillis() - pageSwitch;
        for (int i = 0; i < list.size(); i++) {
            Module m = list.get(i);
            float x = clipX + (i % cols) * (cw + gap);
            float y = startY + (i / cols) * (ch + gap);
            float p = Animation.easeOutCubic((since - Math.min(i, 15) * 28) / 320f);
            if (p < 1) {
                ctx.setAlpha(alpha * Math.max(0, p));
                ctx.push();
                ctx.translate(0, (1 - p) * 14);
                renderCard(ctx, mx, my - (1 - p) * 14, m, x, y, cw, ch);
                ctx.pop();
                ctx.setAlpha(alpha);
            } else {
                renderCard(ctx, mx, my, m, x, y, cw, ch);
            }
        }
        int rows = (list.size() + cols - 1) / cols;
        contentHeight = rows * (ch + gap) + 4;
    }

    private void renderCard(Gfx ctx, double mx, double my, Module m, float x, float y, float w, float h) {
        float sx = x + w - 11, sy = listView ? y + h / 2f : y + 11;
        if (listView) sx = x + w - 48;
        if (y > clipY + scroll.get() + clipH + 10 || y + h < clipY + scroll.get() - 10) {
            hit(x, y, w, h, true, cardAction(m, x, y, w, h));
            hit(sx - 7, sy - 7, 14, 14, true, (a, b, c) -> toggleFavorite(m));
            return;
        }
        boolean hov = hovered(mx, my, x, y, w, h, true);
        float ha = anim(m.getName() + "_hover", 14).target(hov ? 1 : 0).update();
        float ta = anim(m.getName() + "_on", 14).target(m.isEnabled() ? 1 : 0).update();
        float r = Theme.radius();
        float lift = listView ? 0 : ha;
        float yy = y - lift;
        boolean toggleable = m.isToggleable();

        if (ta > 0.01f && toggleable) Render2D.shadow(ctx, x, yy, w, h, r, 5, ColorUtil.withAlpha(Theme.accent(), (int) ((50 + 40 * ha) * ta)));
        Render2D.roundedRect(ctx, x, yy, w, h, r, ColorUtil.lerp(Theme.CARD, Theme.CARD_HOVER, ha));
        if (ta > 0.01f && toggleable) Render2D.roundedGradient(ctx, x, yy, w, h, r,
                ColorUtil.withAlpha(Theme.accent(), (int) (30 * ta)), ColorUtil.withAlpha(Theme.accent(), (int) (6 * ta)), !listView);
        int outline = toggleable ? ColorUtil.lerp(Theme.OUTLINE, ColorUtil.withAlpha(Theme.accent(), 200), ta) : Theme.OUTLINE;
        Render2D.roundedOutline(ctx, x, yy, w, h, r, 1, outline);

        // favourite star
        boolean hs = hovered(mx, my, sx - 7, sy - 7 - lift, 14, 14, true);
        float sa = anim(m.getName() + "_star", 16).target(hs ? 1 : 0).update();
        if (m.isFavorite()) Icons.star(ctx, sx, sy - lift, 4.6f + sa, Theme.WARNING, true);
        else if (hov || sa > 0.01f) Icons.star(ctx, sx, sy - lift, 4.6f + sa, ColorUtil.lerp(Theme.TEXT_MUTED, Theme.WARNING, sa), false);

        if (listView) {
            Icons.tile(ctx, m.getCategory(), x + 6, yy + 6, 18, ta);
            String name = m.getName();
            Render2D.text(ctx, name, x + 30, yy + 6, Theme.TEXT);
            float nx = x + 30 + Render2D.textWidth(name) + 6;
            if (ExtraModules.isNew(m)) { newBadge(ctx, nx, yy + 5); nx += 36; }
            if (m.getKeybind().isBound()) keyChip(ctx, m, nx, yy + 4.5f);
            Render2D.scaledText(ctx, Render2D.trim(m.getDescription(), (int) ((w - 120) / 0.75f)), x + 30, yy + 18, 0.75f, Theme.TEXT_DIM, false);
            if (toggleable) Widgets.toggle(ctx, x + w - 34, yy + h / 2f - 6.5f, 26, 13, ta);
            else Render2D.text(ctx, "›", x + w - 16, yy + h / 2f - 4, Theme.accent());
            hit(x, y, w, h, true, cardAction(m, x, y, w, h));
            hit(sx - 7, sy - 7, 14, 14, true, (a, b, c) -> toggleFavorite(m));
            return;
        }

        Icons.tile(ctx, m.getCategory(), x + 7, yy + 7, 18, ta);
        Render2D.text(ctx, Render2D.trim(m.getName(), (int) (w - 48)), x + 30, yy + 7, Theme.TEXT);
        String cat = m.getCategory().displayName.toUpperCase();
        Render2D.scaledText(ctx, cat, x + 30, yy + 17.5f, 0.6f, ColorUtil.withAlpha(m.getCategory().color, 200), false);
        if (ExtraModules.isNew(m)) newBadge(ctx, x + 33 + Render2D.textWidth(cat) * 0.6f, yy + 15.5f);
        if (guiModule().showDescriptions.isOn()) {
            String d = m.getDescription();
            int maxW = (int) ((w - 16) / 0.75f);
            String l1 = d, l2 = "";
            if (Render2D.textWidth(d) > maxW) {
                int cut = d.length();
                while (cut > 0 && Render2D.textWidth(d.substring(0, cut)) > maxW) cut = d.lastIndexOf(' ', cut - 1);
                if (cut <= 0) cut = Math.min(d.length(), 20);
                l1 = d.substring(0, cut);
                l2 = Render2D.trim(d.substring(cut).trim(), maxW);
            }
            Render2D.scaledText(ctx, l1, x + 8, yy + 29, 0.75f, Theme.TEXT_DIM, false);
            if (!l2.isEmpty()) Render2D.scaledText(ctx, l2, x + 8, yy + 37, 0.75f, Theme.TEXT_DIM, false);
        }

        float by = yy + h - 17;
        if (toggleable) {
            boolean gh = hovered(mx, my, x + 6, by, 50, 14, true);
            float ga = anim(m.getName() + "_gear", 16).target(gh ? 1 : 0).update();
            int gc = ColorUtil.lerp(Theme.TEXT_MUTED, Theme.accent(), ga);
            Icons.sliders(ctx, x + 12.5f, by + 6.5f, 8, gc);
            Render2D.text(ctx, "Opcje", x + 20 + ga * 1.5f, by + 3, gc);
            Widgets.toggle(ctx, x + w - 32, by, 26, 13, ta);
        } else {
            Render2D.text(ctx, "Otwórz ›", x + w - 8 - Render2D.textWidth("Otwórz ›"), by + 3, Theme.accent());
        }
        if (m.getKeybind().isBound()) {
            float kw = Render2D.textWidth(m.getKeybind().getKeyName()) * 0.75f + 8;
            keyChip(ctx, m, x + w - (toggleable ? 38 : 8 + Render2D.textWidth("Otwórz ›") + 6) - kw, by + 1);
        }
        hit(x, y, w, h, true, cardAction(m, x, y, w, h));
        hit(sx - 7, sy - 7, 14, 14, true, (a, b, c) -> toggleFavorite(m));
    }

    private void keyChip(Gfx ctx, Module m, float kx, float ky) {
        String k = m.getKeybind().getKeyName();
        float kw = Render2D.textWidth(k) * 0.75f + 8;
        Render2D.roundedRect(ctx, kx, ky, kw, 11, 3, 0x26FFFFFF);
        Render2D.roundedOutline(ctx, kx, ky, kw, 11, 3, 1, 0x18FFFFFF);
        Render2D.scaledText(ctx, k, kx + 4, ky + 2.5f, 0.75f, Theme.TEXT_DIM, false);
    }

    private ClickAction cardAction(Module m, float x, float y, float w, float h) {
        return (cx, cy, button) -> {
            boolean onOptions = !listView && cx < x + 56 && cy > y + h - 20;
            if (button == 1 || !m.isToggleable() || onOptions || (listView && cx < x + w - 60)) {
                switchPage(Page.SETTINGS, m);
            } else if (button == 0) {
                m.toggle();
                Sounds.toggle(m.isEnabled());
            }
        };
    }

    // ------------------------------------------------------------------ settings page

    private void renderSettings(Gfx ctx, double mx, double my) {
        Module m = selected;
        float x = clipX, w = clipW;
        float y = clipY + 2;

        // top row: enabled + keybind
        if (m.isToggleable()) {
            y = row(ctx, x, y, w, 30, "Włączony", "Włącz lub wyłącz moduł", mx, my);
            float ta = anim(m.getName() + "_on", 14).target(m.isEnabled() ? 1 : 0).update();
            Widgets.toggle(ctx, x + w - 40, y - 30 + 9, 30, 13, ta);
            hit(x, y - 30, w, 30, true, (a, b, c) -> {
                m.toggle();
                Sounds.toggle(m.isEnabled());
            });
        }
        y = keybindRow(ctx, x, y, w, m.getKeybind(), mx, my);

        for (Setting<?> s : m.getSettings()) {
            if (!s.isVisible()) continue;
            if (s instanceof BooleanSetting) y = boolRow(ctx, x, y, w, (BooleanSetting) s, mx, my);
            else if (s instanceof NumberSetting) y = numberRow(ctx, x, y, w, (NumberSetting) s, mx, my);
            else if (s instanceof ModeSetting) y = modeRow(ctx, x, y, w, (ModeSetting) s, mx, my);
            else if (s instanceof ColorSetting) y = colorRow(ctx, x, y, w, (ColorSetting) s, mx, my);
            else if (s instanceof KeybindSetting) y = keybindRow(ctx, x, y, w, (KeybindSetting) s, mx, my);
            else if (s instanceof StringSetting) y = stringRow(ctx, x, y, w, (StringSetting) s, mx, my);
        }

        // reset button
        y += 4;
        boolean hr = hovered(mx, my, x, y, 130, 20, true);
        Widgets.button(ctx, x, y, 130, 20, "↺ Przywróć domyślne", anim("reset_mod", 14).target(hr ? 1 : 0).update(), false);
        hit(x, y, 130, 20, true, (a, b, c) -> {
            for (Setting<?> s : m.getSettings()) s.reset();
            Sounds.click();
            NotificationManager.push(m.getName(), "Przywrócono ustawienia domyślne", NotificationManager.Type.INFO);
        });
        y += 26;
        contentHeight = y - clipY;
    }

    private float row(Gfx ctx, float x, float y, float w, float h, String name, String desc, double mx, double my) {
        boolean hov = hovered(mx, my, x, y, w, h, true);
        float ha = anim("row_" + (selected == null ? "" : selected.getName()) + name, 16).target(hov ? 1 : 0).update();
        Render2D.roundedRect(ctx, x, y, w, h - 4, Theme.radius(), ColorUtil.lerp(Theme.PANEL, Theme.CARD, ha));
        Render2D.text(ctx, name, x + 9, y + 5, Theme.TEXT);
        Render2D.scaledText(ctx, Render2D.trim(desc, 300), x + 9, y + 16, 0.75f, Theme.TEXT_MUTED, false);
        return y + h;
    }

    private float boolRow(Gfx ctx, float x, float y, float w, BooleanSetting s, double mx, double my) {
        float top = y;
        y = row(ctx, x, y, w, 30, s.getName(), s.getDescription(), mx, my);
        float ta = anim(s, 14).target(s.isOn() ? 1 : 0).update();
        Widgets.toggle(ctx, x + w - 40, top + 9, 30, 13, ta);
        hit(x, top, w, 26, true, (a, b, c) -> {
            s.toggle();
            Sounds.toggle(s.isOn());
        });
        return y;
    }

    private float numberRow(Gfx ctx, float x, float y, float w, NumberSetting s, double mx, double my) {
        float top = y;
        y = row(ctx, x, y, w, 30, s.getName(), s.getDescription(), mx, my);
        float sw = 130, sx = x + w - sw - 12, sy = top + 12;
        double range = s.getMax() - s.getMin();
        float target = (float) ((s.get() - s.getMin()) / range);
        float p = anim(s, 18).target(target).update();
        Render2D.roundedRect(ctx, sx, sy, sw, 4, 2, 0xFF2E2621);
        Render2D.roundedGradient(ctx, sx, sy, Math.max(4, sw * p), 4, 2, Theme.accent(), Theme.accent2(), false);
        boolean kh = drag != null && dragTarget == s || hovered(mx, my, sx - 4, top, sw + 8, 26, true);
        float kr = kh ? 5 : 4;
        Render2D.circle(ctx, sx + sw * p, sy + 2, kr, 0xFFFFFFFF);
        String v = s.format();
        Render2D.text(ctx, v, sx - 8 - Render2D.textWidth(v), top + 9, Theme.TEXT_DIM);
        hit(x, top, w, 26, true, (a, b, button) -> {
            if (button == 1) {
                s.reset();
                return;
            }
            dragTarget = s;
            drag = (dmx, dmy) -> {
                double f = Math.max(0, Math.min(1, (dmx - sx) / sw));
                s.set(s.getMin() + f * range);
            };
            drag.drag(a, b);
        });
        return y;
    }

    private Object dragTarget;

    private float modeRow(Gfx ctx, float x, float y, float w, ModeSetting s, double mx, double my) {
        float top = y;
        y = row(ctx, x, y, w, 30, s.getName(), s.getDescription(), mx, my);
        float pw = 110, px = x + w - pw - 10, py = top + 5;
        boolean hov = hovered(mx, my, px, py, pw, 16, true);
        int[] swatch = dev.noreclient.module.client.ClientSettings.presetColors(s.get());
        if (s.getName().equals("Theme Preset") && swatch != null) {
            Render2D.circle(ctx, px - 18, py + 8, 5, swatch[0]);
            Render2D.circle(ctx, px - 8, py + 8, 5, swatch[1]);
            Render2D.ring(ctx, px - 18, py + 8, 5, 1, 0, 360, 0x40FFFFFF);
        }
        Render2D.roundedRect(ctx, px, py, pw, 16, 8, hov ? Theme.CARD_HOVER : 0xFF2A231D);
        Render2D.text(ctx, "‹", px + 6, py + 4, hov ? Theme.accent() : Theme.TEXT_MUTED);
        Render2D.text(ctx, "›", px + pw - 10, py + 4, hov ? Theme.accent() : Theme.TEXT_MUTED);
        Animation slide = anim("mode_" + s.hashCode(), 16);
        slide.update();
        float sv = slide.get();
        ctx.scissor((int) ((px + 14 + ox) * scale), (int) ((py + oy - scroll.get()) * scale),
                (int) ((px + pw - 14 + ox) * scale), (int) ((py + 16 + oy - scroll.get()) * scale));
        Render2D.centeredText(ctx, Render2D.trim(s.get(), (int) pw - 26), px + pw / 2f + sv * 30, py + 4,
                ColorUtil.fade(Theme.TEXT, 1 - Math.abs(sv)), false);
        ctx.endScissor();
        int idx = s.getModes().indexOf(s.get());
        float dotW = s.getModes().size() * 5f;
        for (int i = 0; i < s.getModes().size(); i++) {
            Render2D.circle(ctx, px + pw / 2f - dotW / 2f + i * 5 + 2.5f, py + 19.5f, 1.2f, i == idx ? Theme.accent() : 0x40FFFFFF);
        }
        hit(x, top, w, 26, true, (a, b, button) -> {
            boolean forward = button == 0 && !(a >= px && a < px + pw / 2f && b >= py && b < py + 16);
            if (button == 1) forward = false;
            s.cycle(forward);
            slide.set(forward ? 1 : -1);
            slide.target(0);
            Sounds.click();
        });
        return y;
    }

    private float colorRow(Gfx ctx, float x, float y, float w, ColorSetting s, double mx, double my) {
        boolean expanded = expandedColor == s;
        float ea = anim(s, 14).target(expanded ? 1 : 0).update();
        float extra = 84 * Animation.easeOutCubic(ea);
        float top = y;
        boolean hov = hovered(mx, my, x, y, w, 26, true);
        float ha = anim("row_c_" + s.hashCode(), 16).target(hov || expanded ? 1 : 0).update();
        Render2D.roundedRect(ctx, x, y, w, 26 + extra, Theme.radius(), ColorUtil.lerp(Theme.PANEL, Theme.CARD, ha));
        Render2D.text(ctx, s.getName(), x + 9, y + 5, Theme.TEXT);
        Render2D.scaledText(ctx, s.getDescription(), x + 9, y + 16, 0.75f, Theme.TEXT_MUTED, false);
        float swx = x + w - 44;
        Widgets.checker(ctx, swx, top + 6, 32, 14, 4);
        Render2D.roundedRect(ctx, swx, top + 6, 32, 14, 3, s.getColor());
        Render2D.roundedOutline(ctx, swx, top + 6, 32, 14, 3, 1, 0x40FFFFFF);
        String hex = ColorUtil.toHex(s.get());
        Render2D.scaledText(ctx, hex, swx - 6 - Render2D.textWidth(hex) * 0.8f, top + 10, 0.8f, Theme.TEXT_MUTED, false);
        hit(x, top, w, 26, true, (a, b, c) -> {
            expandedColor = expanded ? null : s;
            pickerHsb = ColorUtil.toHsb(s.get());
            Sounds.click();
        });

        if (ea > 0.05f) {
            float py = top + 30;
            float alpha = ea;
            // saturation / brightness square
            float sqx = x + 10, sqw = 140, sqh = 70;
            int hueColor = ColorUtil.hsb(pickerHsb[0], 1, 1, 255);
            if (extra > 20) {
                ctx.scissor((int) ((sqx + ox) * scale), (int) ((top + 26 + oy - scroll.get()) * scale),
                        (int) ((x + w + ox) * scale), (int) ((top + 26 + extra + oy - scroll.get()) * scale));
                // nested scissor intersects with the content clip in vanilla's scissor stack
                Render2D.quadGradient(ctx, sqx, py, sqw, sqh, 0xFFFFFFFF, hueColor, 0xFF000000, 0xFF000000);
                Render2D.quadGradient(ctx, sqx, py, sqw, sqh, 0xFFFFFFFF, hueColor, ColorUtil.withAlpha(hueColor, 0), 0x00FFFFFF);
                Render2D.quadGradient(ctx, sqx, py, sqw, sqh, 0x00000000, 0x00000000, 0xFF000000, 0xFF000000);
                float kx = sqx + pickerHsb[1] * sqw, ky = py + (1 - pickerHsb[2]) * sqh;
                Render2D.ring(ctx, kx, ky, 4, 1.5f, 0, 360, 0xFFFFFFFF);

                // hue bar
                float hx = sqx + sqw + 8, hw = 10;
                for (int i = 0; i < 6; i++) {
                    int c1 = ColorUtil.hsb(i / 6f, 1, 1, 255), c2 = ColorUtil.hsb((i + 1) / 6f, 1, 1, 255);
                    Render2D.quadGradient(ctx, hx, py + sqh * i / 6f, hw, sqh / 6f, c1, c1, c2, c2);
                }
                Render2D.rect(ctx, hx - 1, py + pickerHsb[0] * sqh - 1, hw + 2, 2, 0xFFFFFFFF);

                // alpha bar
                float ax = hx + hw + 6;
                Widgets.checker(ctx, ax, py, hw, sqh, 5);
                int opaque = ColorUtil.withAlpha(s.get(), 255);
                Render2D.quadGradient(ctx, ax, py, hw, sqh, opaque, opaque, ColorUtil.withAlpha(opaque, 0), ColorUtil.withAlpha(opaque, 0));
                float af = ColorUtil.alpha(s.get()) / 255f;
                Render2D.rect(ctx, ax - 1, py + (1 - af) * sqh - 1, hw + 2, 2, 0xFFFFFFFF);

                // chroma + info
                float ix = ax + hw + 14;
                float ca = anim(s.getName() + "_chroma" + s.hashCode(), 14).target(s.isChroma() ? 1 : 0).update();
                Render2D.text(ctx, "Chroma (tęcza)", ix, py + 3, ColorUtil.fade(Theme.TEXT, alpha));
                Widgets.toggle(ctx, ix + 80, py + 1, 26, 12, ca);
                Render2D.text(ctx, "Alpha: " + ColorUtil.alpha(s.get()), ix, py + 22, Theme.TEXT_DIM);
                Render2D.text(ctx, "RGB: " + ColorUtil.red(s.get()) + ", " + ColorUtil.green(s.get()) + ", " + ColorUtil.blue(s.get()), ix, py + 34, Theme.TEXT_DIM);
                boolean rh = hovered(mx, my, ix, py + 50, 60, 16, true);
                Widgets.button(ctx, ix, py + 50, 60, 16, "Reset", anim("cr_" + s.hashCode(), 14).target(rh ? 1 : 0).update(), false);
                ctx.endScissor();

                hit(sqx, py, sqw, sqh, true, (a, b, c) -> startDrag(s, (dmx, dmy) -> {
                    pickerHsb[1] = (float) Math.max(0, Math.min(1, (dmx - sqx) / sqw));
                    pickerHsb[2] = (float) Math.max(0, Math.min(1, 1 - (dmy - py) / sqh));
                    applyPicker(s);
                }, a, b));
                hit(hx - 2, py, hw + 4, sqh, true, (a, b, c) -> startDrag(s, (dmx, dmy) -> {
                    pickerHsb[0] = (float) Math.max(0, Math.min(0.999, (dmy - py) / sqh));
                    applyPicker(s);
                }, a, b));
                hit(ax - 2, py, hw + 4, sqh, true, (a, b, c) -> startDrag(s, (dmx, dmy) -> {
                    int al = (int) Math.round(255 * Math.max(0, Math.min(1, 1 - (dmy - py) / sqh)));
                    s.set(ColorUtil.withAlpha(s.get(), al));
                }, a, b));
                hit(ix + 80, py, 26, 14, true, (a, b, c) -> {
                    s.setChroma(!s.isChroma());
                    Sounds.toggle(s.isChroma());
                });
                hit(ix, py + 50, 60, 16, true, (a, b, c) -> {
                    s.reset();
                    pickerHsb = ColorUtil.toHsb(s.get());
                    Sounds.click();
                });
            }
        }
        return top + 30 + extra;
    }

    private void startDrag(Object target, DragAction action, double mx, double my) {
        dragTarget = target;
        drag = action;
        action.drag(mx, my);
    }

    private void applyPicker(ColorSetting s) {
        int a = ColorUtil.alpha(s.get());
        s.set(ColorUtil.hsb(pickerHsb[0], pickerHsb[1], pickerHsb[2], a));
    }

    private float keybindRow(Gfx ctx, float x, float y, float w, KeybindSetting s, double mx, double my) {
        float top = y;
        y = row(ctx, x, y, w, 30, s.getName(), "Kliknij i naciśnij klawisz (ESC = anuluj, DEL = usuń)", mx, my);
        boolean isListening = listening == s;
        String label = isListening ? "Naciśnij klawisz..." : s.getKeyName();
        float bw = Math.max(60, Render2D.textWidth(label) + 16), bx = x + w - bw - 10;
        float la = anim(s, 14).target(isListening ? 1 : 0).update();
        Render2D.roundedRect(ctx, bx, top + 5, bw, 16, Theme.radius(), ColorUtil.lerp(0xFF2A231D, ColorUtil.withAlpha(Theme.accent(), 120), la));
        Render2D.centeredText(ctx, label, bx + bw / 2f, top + 9, isListening ? Theme.TEXT : Theme.TEXT_DIM, false);
        hit(x, top, w, 26, true, (a, b, button) -> {
            if (button == 1) {
                s.set(Keys.UNKNOWN);
                listening = null;
            } else {
                listening = isListening ? null : s;
            }
            Sounds.click();
        });
        return y;
    }

    // ------------------------------------------------------------------ downloads page (resource packs from Modrinth)

    private static final String[][] DL_SORTS = {{"relevance", "Trafność"}, {"downloads", "Pobrania"}, {"follows", "Obserwujący"}, {"newest", "Nowe"}, {"updated", "Aktualne"}};
    private static final String[][] DL_CATS = {{"", "Wszystkie"}, {"combat", "PvP"}, {"vanilla-like", "Jak vanilla"}, {"simplistic", "Proste"},
            {"realistic", "Realistyczne"}, {"gui", "Interfejs"}, {"tweaks", "Poprawki"}, {"themed", "Tematyczne"}, {"16x", "16x"}, {"32x", "32x"}, {"64x", "64x+"}};

    private static String dlCatLabel(String c) {
        for (String[] e : DL_CATS) if (e[0].equals(c)) return e[1];
        return c.isEmpty() ? c : Character.toUpperCase(c.charAt(0)) + c.substring(1).replace('-', ' ');
    }

    private static String fmtCount(long n) {
        return n >= 1_000_000 ? String.format("%.1fM", n / 1e6) : n >= 1000 ? String.format("%.1fK", n / 1e3) : String.valueOf(n);
    }

    private void runSearch(boolean append) {
        if (!append) {
            dlResults.clear();
            scroll.set(0);
        }
        dlQuery = dlSearch.getText();
        dlLoading = true;
        dlError = null;
        final int req = ++dlRequest;
        Modrinth.search(dlQuery, dlCategory, dlSort, append ? dlResults.size() : 0, (res, t) -> NoreClient.runNextTick(() -> {
            if (req != dlRequest) return;
            dlLoading = false;
            if (t != null) {
                dlError = "Brak połączenia z Modrinth";
                return;
            }
            dlResults.addAll(res.hits);
            dlTotal = res.total;
            dlMore = dlResults.size() < res.total && res.hits.size() == Modrinth.PAGE;
            if (!append) pageSwitch = System.currentTimeMillis();
        }));
    }

    private void install(Modrinth.Hit h) {
        dlState.put(h.id, "loading");
        Sounds.click();
        Modrinth.install(h.id, (file, t) -> NoreClient.runNextTick(() -> {
            if (t != null) {
                dlState.put(h.id, "error");
                Throwable c = t.getCause() != null ? t.getCause() : t;
                NotificationManager.push(Render2D.trim(h.title, 120), String.valueOf(c.getMessage()), NotificationManager.Type.ERROR);
                return;
            }
            dlState.put(h.id, "done:" + file);
            dlLocal = null;
            NotificationManager.push(Render2D.trim(h.title, 120), "Pobrano – kliknij Włącz", NotificationManager.Type.SUCCESS);
        }));
    }

    private List<java.io.File> localPacks() {
        if (dlLocal == null) {
            dlLocal = new ArrayList<>();
            java.io.File[] files = Modrinth.packDir().listFiles();
            if (files != null) {
                for (java.io.File f : files) if (f.isDirectory() || f.getName().toLowerCase().endsWith(".zip")) dlLocal.add(f);
            }
            dlLocal.sort((a, b) -> a.getName().compareToIgnoreCase(b.getName()));
        }
        return dlLocal;
    }

    /** Small pill used for tabs, sorts and categories; returns its width. */
    private float pill(Gfx ctx, double mx, double my, float x, float y, float h, String label, boolean on, Object key, Runnable action) {
        float w = Render2D.textWidth(label) * 0.8f + 14;
        boolean hov = hovered(mx, my, x, y, w, h, true);
        float ha = anim(key, 16).target(hov || on ? 1 : 0).update();
        if (on) Widgets.glowBox(ctx, x, y, w, h, h / 2f, Theme.accent(), 0.2f, 0.85f);
        else {
            Render2D.roundedRect(ctx, x, y, w, h, h / 2f, ColorUtil.lerp(Theme.PANEL, Theme.CARD_HOVER, ha));
            Render2D.roundedOutline(ctx, x, y, w, h, h / 2f, 1, ColorUtil.lerp(Theme.OUTLINE, ColorUtil.withAlpha(Theme.accent(), 110), ha));
        }
        Render2D.scaledText(ctx, label, x + 7, y + h / 2f - 3, 0.8f, on ? 0xFFFFFFFF : ColorUtil.lerp(Theme.TEXT_DIM, Theme.TEXT, ha), false);
        hit(x, y, w, h, true, (a, b, c) -> { Sounds.click(); action.run(); });
        return w;
    }

    private void renderDownloads(Gfx ctx, double mx, double my) {
        if (!dlInstalledTab && (dlQuery == null || (!dlSearch.getText().equals(dlQuery) && System.currentTimeMillis() - dlTyped > 350))) runSearch(false);
        float x = clipX, w = clipW, y = clipY + 2;

        // tabs: browse / installed with a sliding glow pill
        String[] tabs = {"Przeglądaj", "Zainstalowane (" + localPacks().size() + ")"};
        float tw = (w - 6) / 2f;
        float target = x + (dlInstalledTab ? tw + 6 : 0);
        float px = dlTab.target(target).update();
        if (Math.abs(px - target) > w) dlTab.set(target);
        for (int i = 0; i < 2; i++) Render2D.roundedRect(ctx, x + i * (tw + 6), y, tw, 20, Theme.radius(), Theme.PANEL);
        Widgets.glowBox(ctx, dlTab.get(), y, tw, 20, Theme.radius(), Theme.accent(), 0.3f, 1f);
        for (int i = 0; i < 2; i++) {
            float bx = x + i * (tw + 6);
            boolean on = (i == 1) == dlInstalledTab;
            boolean hov = hovered(mx, my, bx, y, tw, 20, true);
            float ic = bx + tw / 2f - Render2D.textWidth(tabs[i]) / 2f - 8;
            if (i == 0) Icons.globe(ctx, ic, y + 10, 8, on ? 0xFFFFFFFF : Theme.TEXT_MUTED);
            else Icons.download(ctx, ic, y + 10, 8, on ? 0xFFFFFFFF : Theme.TEXT_MUTED);
            Render2D.centeredText(ctx, tabs[i], bx + tw / 2f + 5, y + 6, on ? Widgets.glowText(Theme.accent(), 0.4f) : hov ? Theme.TEXT : Theme.TEXT_DIM, false);
            final boolean inst = i == 1;
            hit(bx, y, tw, 20, true, (a, b, c) -> {
                if (dlInstalledTab == inst) return;
                dlInstalledTab = inst;
                dlLocal = null;
                scroll.set(0);
                pageSwitch = System.currentTimeMillis();
                Sounds.click();
            });
        }
        y += 27;
        if (dlInstalledTab) { renderInstalledPacks(ctx, mx, my, x, y, w); return; }

        // sort + category pills (wrapping)
        float sx = x;
        Render2D.scaledText(ctx, "SORTUJ", sx, y + 4, 0.65f, Theme.TEXT_MUTED, false);
        sx += 32;
        for (String[] srt : DL_SORTS) {
            sx += pill(ctx, mx, my, sx, y, 13, srt[1], dlSort.equals(srt[0]), "dls_" + srt[0], () -> { dlSort = srt[0]; runSearch(false); }) + 4;
        }
        y += 18;
        sx = x;
        for (String[] cat : DL_CATS) {
            float cw = Render2D.textWidth(cat[1]) * 0.8f + 14;
            if (sx + cw > x + w) { sx = x; y += 17; }
            sx += pill(ctx, mx, my, sx, y, 13, cat[1], dlCategory.equals(cat[0]), "dlc_" + cat[0], () -> { dlCategory = cat[0]; runSearch(false); }) + 4;
        }
        y += 19;
        String info = dlLoading && dlResults.isEmpty() ? "Szukam..." : fmtCount(dlTotal) + " paczek zasobów dla Minecraft " + Modrinth.gameVersion();
        Render2D.scaledText(ctx, info, x + 1, y, 0.72f, Theme.TEXT_MUTED, false);
        y += 11;

        if (dlResults.isEmpty()) {
            if (dlLoading) {
                for (int i = 0; i < 4; i++) {
                    float cw = (w - 6) / 2f, cx = x + (i % 2) * (cw + 6), cy = y + (i / 2) * 78;
                    float sh = 0.5f + 0.5f * (float) Math.sin(System.currentTimeMillis() / 220.0 + i);
                    Render2D.roundedRect(ctx, cx, cy, cw, 72, Theme.radius(), ColorUtil.lerp(Theme.PANEL, Theme.CARD, sh * 0.6f));
                }
            } else {
                Icons.download(ctx, x + w / 2f, y + 40, 16, ColorUtil.withAlpha(Theme.accent(), 160));
                Render2D.centeredText(ctx, dlError != null ? dlError : "Brak wyników", x + w / 2f, y + 56, Theme.TEXT_MUTED, false);
            }
            contentHeight = y + 170 - clipY;
            return;
        }

        long since = System.currentTimeMillis() - pageSwitch;
        float cw = (w - 6) / 2f, ch = 74;
        for (int i = 0; i < dlResults.size(); i++) {
            Modrinth.Hit h = dlResults.get(i);
            float cx = x + (i % 2) * (cw + 6), cy = y + (i / 2) * (ch + 6);
            if (cy > clipY + scroll.get() + clipH || cy + ch < clipY + scroll.get()) continue;
            float p = Animation.easeOutCubic((since - Math.min(i, 12) * 35) / 320f);
            ctx.setAlpha(alpha * Math.max(0, Math.min(1, p)));
            float ry = cy + (1 - Math.max(0, p)) * 14;
            renderPackCard(ctx, mx, my, h, cx, ry, cw, ch);
            ctx.setAlpha(alpha);
        }
        y += ((dlResults.size() + 1) / 2) * (ch + 6);
        if (dlMore) {
            boolean lh = hovered(mx, my, x + w / 2f - 60, y + 2, 120, 18, true);
            if (dlLoading) {
                float a = (System.currentTimeMillis() % 1000) / 1000f * 360;
                Render2D.ring(ctx, x + w / 2f, y + 11, 6, 2f, a, a + 260, Theme.accent());
            } else {
                Widgets.button(ctx, x + w / 2f - 60, y + 2, 120, 18, "Załaduj więcej", anim("dl_more", 14).target(lh ? 1 : 0).update(), false);
                hit(x + w / 2f - 60, y + 2, 120, 18, true, (a, b, c) -> runSearch(true));
            }
            y += 26;
        }
        Render2D.scaledText(ctx, "PPM na kafelku otwiera stronę paczki na Modrinth", x, y + 2, 0.7f, Theme.TEXT_MUTED, false);
        contentHeight = y + 14 - clipY;
    }

    private void renderPackCard(Gfx ctx, double mx, double my, Modrinth.Hit h, float x, float y, float w, float hgt) {
        boolean hov = hovered(mx, my, x, y, w, hgt, true);
        float ha = anim("dl_" + h.id, 14).target(hov ? 1 : 0).update();
        float r = Theme.radius();
        if (ha > 0.01f) Render2D.shadow(ctx, x, y, w, hgt, r, 5, ColorUtil.withAlpha(Theme.accent(), (int) (60 * ha)));
        Render2D.roundedRect(ctx, x, y, w, hgt, r, ColorUtil.lerp(Theme.PANEL, Theme.CARD, 0.4f + 0.6f * ha));
        // tinted header band
        Render2D.roundedGradient(ctx, x, y, w, 26, r, ColorUtil.withAlpha(Theme.accent(), (int) (55 + 35 * ha)), ColorUtil.withAlpha(Theme.accent(), 0), true);
        Render2D.roundedOutline(ctx, x, y, w, hgt, r, 1, ColorUtil.lerp(Theme.OUTLINE, ColorUtil.withAlpha(Theme.accent(), 150), ha));

        // icon
        float is = 30 + ha * 2, ix = x + 7 - ha, iy = y + 7 - ha;
        Render2D.shadow(ctx, ix, iy, is, is, 7, 3, 0x60000000);
        dev.noreclient.api.TextureRef icon = Modrinth.icon(h.iconUrl);
        if (icon != null) {
            Render2D.roundedRect(ctx, ix, iy, is, is, 7, 0xFF1A1411);
            Render2D.texture(ctx, icon, ix, iy, is, is, 1f);
        } else {
            Render2D.roundedGradient(ctx, ix, iy, is, is, 7, Theme.accent2(), Theme.accent(), true);
            Render2D.centeredText(ctx, h.title.isEmpty() ? "?" : h.title.substring(0, 1).toUpperCase(), ix + is / 2f, iy + is / 2f - 4, 0xFFFFFFFF, true);
        }
        float tx = x + 44, maxW = w - 50;
        Render2D.text(ctx, Render2D.trim(h.title, (int) maxW), tx, y + 9, Theme.TEXT);
        Render2D.scaledText(ctx, Render2D.trim("od " + h.author, (int) (maxW / 0.7f)), tx, y + 20, 0.7f, Theme.TEXT_MUTED, false);

        // description: two wrapped lines
        String[] lines = wrap(h.description, (int) ((w - 14) / 0.72f), 2);
        for (int l = 0; l < lines.length; l++) Render2D.scaledText(ctx, lines[l], x + 7, y + 41 + l * 8, 0.72f, Theme.TEXT_DIM, false);

        // footer: stats + category + button
        float fy = y + hgt - 15;
        String stats = "⬇ " + fmtCount(h.downloads) + "   ❤ " + fmtCount(h.follows);
        Render2D.scaledText(ctx, stats, x + 7, fy + 4, 0.66f, Theme.TEXT_MUTED, false);
        if (!h.categories.isEmpty()) {
            String cat = dlCatLabel(h.categories.get(0));
            float cx = x + 9 + Render2D.textWidth(stats) * 0.66f + 4, cwid = Render2D.textWidth(cat) * 0.62f + 8;
            if (cx + cwid < x + w - 66) {
                Render2D.roundedRect(ctx, cx, fy + 2, cwid, 10, 5, ColorUtil.withAlpha(Theme.accent(), 40));
                Render2D.scaledText(ctx, cat, cx + 4, fy + 4.5f, 0.62f, ColorUtil.brighten(Theme.accent(), 0.4f), false);
            }
        }
        String st = dlState.getOrDefault(h.id, "");
        float bw = 56, bh = 14, bx = x + w - bw - 6, by = fy;
        boolean bhov = hovered(mx, my, bx, by, bw, bh, true);
        float ba = anim("dlb_" + h.id, 16).target(bhov ? 1 : 0).update();
        int col = Theme.accent();
        String label;
        if (st.equals("loading")) {
            Widgets.glowBox(ctx, bx, by, bw, bh, 7, col, 0.2f, 0.8f);
            float a = (System.currentTimeMillis() % 900) / 900f * 360;
            Render2D.ring(ctx, bx + bw / 2f, by + bh / 2f, 4, 1.4f, a, a + 260, Widgets.glowText(col, 0));
            label = null;
        } else if (st.equals("enabled")) {
            col = Theme.SUCCESS;
            label = "✔ Włączona";
        } else if (st.startsWith("done:")) {
            label = "Włącz";
        } else {
            label = st.equals("error") ? "Ponów" : "Pobierz";
        }
        if (label != null) {
            Widgets.glowBox(ctx, bx, by, bw, bh, 7, col, ba, 1f);
            Render2D.scaledText(ctx, label, bx + bw / 2f - Render2D.textWidth(label) * 0.4f, by + 4, 0.8f, Widgets.glowText(col, ba), false);
            final String state = st;
            hit(bx, by, bw, bh, true, (a, b, c) -> {
                if (state.equals("loading") || state.equals("enabled")) return;
                if (state.startsWith("done:")) {
                    game().enableResourcePack(state.substring(5));
                    dlState.put(h.id, "enabled");
                    Sounds.toggle(true);
                    return;
                }
                install(h);
            });
        }
        hit(x, y, w, hgt - 16, true, (a, b, c) -> {
            if (c == 1) game().openUrl("https://modrinth.com/resourcepack/" + h.slug);
        });
    }

    private void renderInstalledPacks(Gfx ctx, double mx, double my, float x, float y, float w) {
        List<java.io.File> packs = localPacks();
        Render2D.scaledText(ctx, packs.size() + " paczek w resourcepacks/ • włączonych: " + game().activeResourcePacks(), x + 1, y, 0.72f, Theme.TEXT_MUTED, false);
        float fw = 74, fx = x + w - fw;
        boolean fh = hovered(mx, my, fx, y - 4, fw, 14, true);
        Widgets.glowBox(ctx, fx, y - 4, fw, 14, 7, Theme.accent(), anim("dl_folder", 14).target(fh ? 1 : 0).update(), 0.6f);
        Render2D.scaledText(ctx, "Otwórz folder", fx + 8, y - 0.5f, 0.75f, 0xFFFFFFFF, false);
        hit(fx, y - 4, fw, 14, true, (a, b, c) -> game().openUrl(Modrinth.packDir().toURI().toString()));
        y += 14;
        if (packs.isEmpty()) {
            Icons.download(ctx, x + w / 2f, y + 40, 16, ColorUtil.withAlpha(Theme.accent(), 160));
            Render2D.centeredText(ctx, "Nie masz jeszcze paczek – znajdziesz je w zakładce Przeglądaj", x + w / 2f, y + 56, Theme.TEXT_MUTED, false);
            contentHeight = y + 90 - clipY;
            return;
        }
        long since = System.currentTimeMillis() - pageSwitch;
        for (int i = 0; i < packs.size(); i++) {
            java.io.File f = packs.get(i);
            float rh = 26;
            if (y > clipY + scroll.get() + clipH || y + rh < clipY + scroll.get()) { y += rh + 4; continue; }
            float p = Animation.easeOutCubic((since - Math.min(i, 12) * 30) / 300f);
            ctx.setAlpha(alpha * Math.max(0, Math.min(1, p)));
            float ry = y + (1 - Math.max(0, p)) * 10;
            boolean on = game().isResourcePackEnabled(f.getName());
            boolean hov = hovered(mx, my, x, ry, w, rh, true);
            float ha = anim("dli_" + f.getName(), 14).target(hov ? 1 : 0).update();
            Render2D.roundedRect(ctx, x, ry, w, rh, Theme.radius(), ColorUtil.lerp(Theme.PANEL, Theme.CARD, ha));
            Render2D.roundedOutline(ctx, x, ry, w, rh, Theme.radius(), 1, on ? ColorUtil.withAlpha(Theme.SUCCESS, 110) : ColorUtil.lerp(Theme.OUTLINE, ColorUtil.withAlpha(Theme.accent(), 110), ha));
            Render2D.roundedGradient(ctx, x + 5, ry + 4, 18, 18, 5, on ? Theme.SUCCESS : Theme.accent2(), on ? ColorUtil.darken(Theme.SUCCESS, 0.3f) : Theme.accent(), true);
            Render2D.centeredText(ctx, f.isDirectory() ? "D" : "Z", x + 14, ry + 9, 0xFFFFFFFF, true);
            String name = f.getName().replaceAll("(?i)\\.zip$", "");
            Render2D.text(ctx, Render2D.trim(name, (int) (w - 100)), x + 30, ry + 5, on ? Theme.TEXT : Theme.TEXT_DIM);
            Render2D.scaledText(ctx, f.isDirectory() ? "folder" : (f.length() / 1024 >= 1024 ? String.format("%.1f MB", f.length() / 1048576.0) : (f.length() / 1024) + " KB"),
                    x + 30, ry + 15.5f, 0.66f, Theme.TEXT_MUTED, false);
            float tgx = x + w - 34;
            Widgets.toggle(ctx, tgx, ry + 7, 26, 12, anim("dlt_" + f.getName(), 14).target(on ? 1 : 0).update());
            hit(tgx - 4, ry + 3, 34, 20, true, (a, b, c) -> {
                if (game().isResourcePackEnabled(f.getName())) game().disableResourcePack(f.getName());
                else game().enableResourcePack(f.getName());
                Sounds.toggle(!on);
            });
            ctx.setAlpha(alpha);
            y += rh + 4;
        }
        contentHeight = y + 6 - clipY;
    }

    /** Greedy word wrap into at most maxLines lines (the last one is trimmed with an ellipsis). */
    private static String[] wrap(String text, int maxWidth, int maxLines) {
        List<String> out = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        for (String word : text.split("\\s+")) {
            String next = line.length() == 0 ? word : line + " " + word;
            if (Render2D.textWidth(next) <= maxWidth) { line.setLength(0); line.append(next); continue; }
            if (out.size() == maxLines - 1) { line.setLength(0); line.append(next); break; }
            if (line.length() > 0) out.add(line.toString());
            line.setLength(0);
            line.append(word);
        }
        if (line.length() > 0 && out.size() < maxLines) out.add(out.size() == maxLines - 1 ? Render2D.trim(line.toString(), maxWidth) : line.toString());
        return out.toArray(new String[0]);
    }

    private float stringRow(Gfx ctx, float x, float y, float w, StringSetting s, double mx, double my) {
        float top = y;
        y = row(ctx, x, y, w, 30, s.getName(), s.getDescription(), mx, my);
        TextBox box = stringBoxes.computeIfAbsent(s, k -> new TextBox("Wpisz tekst...", k.getMaxLength()));
        if (!box.isFocused()) box.setText(s.get());
        else s.set(box.getText());
        float bw = Math.min(200, w * 0.45f), bx = x + w - bw - 8;
        box.render(ctx, bx, top + 4, bw, 18, null);
        hit(bx, top + 4, bw, 18, true, (a, b, c) -> {
            stringBoxes.values().forEach(t -> t.setFocused(false));
            box.setFocused(true);
        });
        return y;
    }

    private TextBox focusedString() {
        for (TextBox t : stringBoxes.values()) if (t.isFocused()) return t;
        return null;
    }

    // ------------------------------------------------------------------ profiles page

    private void renderProfiles(Gfx ctx, double mx, double my) {
        ConfigManager cfg = NoreClient.get().config();
        float x = clipX, w = clipW, y = clipY + 2;

        Render2D.roundedRect(ctx, x, y, w, 44, Theme.radius(), Theme.PANEL);
        Render2D.text(ctx, "Zapisz obecne ustawienia jako profil", x + 9, y + 6, Theme.TEXT);
        float tbw = w - 110;
        profileName.render(ctx, x + 8, y + 18, tbw, 20, "✎");
        hit(x + 8, y + 18, tbw, 20, true, (a, b, c) -> {
            profileName.setFocused(true);
            search.setFocused(false);
        });
        boolean sh = hovered(mx, my, x + w - 94, y + 18, 86, 20, true);
        Widgets.button(ctx, x + w - 94, y + 18, 86, 20, "Zapisz", anim("prof_save", 14).target(sh ? 1 : 0).update(), true);
        hit(x + w - 94, y + 18, 86, 20, true, (a, b, c) -> saveProfile());
        y += 52;

        List<String> profiles = cfg.listProfiles();
        if (profiles.isEmpty()) {
            Render2D.centeredText(ctx, "Nie masz jeszcze żadnych profili.", x + w / 2f, y + 14, Theme.TEXT_MUTED, false);
            y += 34;
        }
        for (String p : profiles) {
            boolean active = p.equals(cfg.getActiveProfile());
            boolean hov = hovered(mx, my, x, y, w, 28, true);
            Render2D.roundedRect(ctx, x, y, w, 28, Theme.radius(), hov ? Theme.CARD : Theme.PANEL);
            if (active) Render2D.roundedRect(ctx, x, y + 6, 2.5f, 16, 1.25f, Theme.accent());
            Render2D.text(ctx, p, x + 10, y + 10, Theme.TEXT);
            if (active) {
                float pw = Render2D.textWidth(p);
                Render2D.roundedRect(ctx, x + 16 + pw, y + 8, 40, 12, 6, ColorUtil.withAlpha(Theme.accent(), 60));
                Render2D.scaledText(ctx, "aktywny", x + 21 + pw, y + 11, 0.75f, Theme.accent(), false);
            }
            float bx = x + w - 130;
            boolean lh = hovered(mx, my, bx, y + 5, 60, 18, true);
            Widgets.button(ctx, bx, y + 5, 60, 18, "Wczytaj", anim("pl_" + p, 14).target(lh ? 1 : 0).update(), false);
            hit(bx, y + 5, 60, 18, true, (a, b, c) -> {
                boolean ok = cfg.loadProfile(p);
                Sounds.click();
                NotificationManager.push("Profil " + p, ok ? "Wczytano profil" : "Nie udało się wczytać",
                        ok ? NotificationManager.Type.SUCCESS : NotificationManager.Type.ERROR);
            });
            boolean dh = hovered(mx, my, bx + 65, y + 5, 60, 18, true);
            float da = anim("pd_" + p, 14).target(dh ? 1 : 0).update();
            Render2D.roundedRect(ctx, bx + 65, y + 5, 60, 18, Theme.radius(), ColorUtil.lerp(0x30F87171, 0x70F87171, da));
            Render2D.centeredText(ctx, "Usuń", bx + 95, y + 10, ColorUtil.lerp(Theme.ERROR, 0xFFFFFFFF, da), false);
            hit(bx + 65, y + 5, 60, 18, true, (a, b, c) -> {
                cfg.deleteProfile(p);
                Sounds.click();
                NotificationManager.push("Profil " + p, "Usunięto profil", NotificationManager.Type.WARNING);
            });
            y += 32;
        }

        y += 8;
        boolean confirm = System.currentTimeMillis() - resetConfirm < 3000;
        boolean rh = hovered(mx, my, x, y, 190, 20, true);
        float ra = anim("reset_all", 14).target(rh ? 1 : 0).update();
        Render2D.roundedRect(ctx, x, y, 190, 20, Theme.radius(), ColorUtil.lerp(0x30F87171, 0x70F87171, ra));
        Render2D.centeredText(ctx, confirm ? "Kliknij ponownie, aby potwierdzić" : "⚠ Resetuj wszystkie ustawienia", x + 95, y + 6, ColorUtil.lerp(Theme.ERROR, 0xFFFFFFFF, ra), false);
        hit(x, y, 190, 20, true, (a, b, c) -> {
            if (System.currentTimeMillis() - resetConfirm < 3000) {
                cfg.resetAll();
                resetConfirm = 0;
                NotificationManager.push("Konfiguracja", "Zresetowano wszystkie ustawienia", NotificationManager.Type.WARNING);
            } else {
                resetConfirm = System.currentTimeMillis();
            }
            Sounds.click();
        });
        y += 28;
        Render2D.scaledText(ctx, "Pliki: .minecraft/config/noreclient/", x, y, 0.75f, Theme.TEXT_MUTED, false);
        contentHeight = y + 12 - clipY;
    }

    private void saveProfile() {
        String name = ConfigManager.sanitize(profileName.getText());
        if (name.isEmpty()) {
            NotificationManager.push("Profil", "Podaj nazwę profilu", NotificationManager.Type.ERROR);
            return;
        }
        boolean ok = NoreClient.get().config().saveProfile(name);
        NotificationManager.push("Profil " + name, ok ? "Zapisano profil" : "Błąd zapisu",
                ok ? NotificationManager.Type.SUCCESS : NotificationManager.Type.ERROR);
        profileName.setText("");
        profileName.setFocused(false);
        Sounds.click();
    }

    // ------------------------------------------------------------------ input

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (closing) return false;
        double mx = mapX(mouseX), my = mapY(mouseY);
        double cmy = my + scroll.get() - (1 - Animation.easeOutCubic(pageAnim.get())) * 10;
        boolean wasSearch = search.isFocused(), wasProfile = profileName.isFocused();
        search.setFocused(false);
        profileName.setFocused(false);
        dlSearch.setFocused(false);
        stringBoxes.values().forEach(t -> t.setFocused(false));
        if (listening != null && button > 1) {
            // allow binding mouse side buttons? keep simple: cancel
            listening = null;
        }
        if (!Render2D.hovered(mx, my, 0, 0, W, H)) {
            close();
            return true;
        }
        List<Hit> snapshot = new ArrayList<>(hits);
        for (int i = snapshot.size() - 1; i >= 0; i--) {
            Hit h = snapshot.get(i);
            double hy = h.clipped ? cmy : my;
            if (h.clipped && !inClip(mx, my)) continue;
            if (Render2D.hovered(mx, hy, h.x, h.y, h.w, h.h)) {
                h.action.click(mx, hy, button);
                return true;
            }
        }
        // clicking empty space keeps focus state consistent
        if (wasSearch && Render2D.hovered(mx, my, W - 162, 12, 150, 22)) search.setFocused(true);
        if (wasProfile) profileName.setFocused(false);
        return true;
    }

    @Override
    public boolean mouseReleased(double mouseX, double mouseY, int button) {
        if (drag != null) {
            drag = null;
            dragTarget = null;
        }
        return true;
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double verticalAmount) {
        float max = Math.max(0, contentHeight - clipH);
        float t = (float) Math.max(0, Math.min(max, scroll.getTarget() - verticalAmount * 28));
        scroll.target(t);
        return true;
    }

    @Override
    public boolean keyPressed(int keyCode, int modifiers) {
        if (listening != null) {
            if (keyCode == Keys.ESCAPE) listening = null;
            else if (keyCode == Keys.DELETE || keyCode == Keys.BACKSPACE) {
                listening.set(Keys.UNKNOWN);
                listening = null;
            } else {
                listening.set(keyCode);
                listening = null;
            }
            Sounds.click();
            return true;
        }
        TextBox fs = focusedString();
        if (fs != null) {
            if (keyCode == Keys.ESCAPE || keyCode == Keys.ENTER) {
                fs.setFocused(false);
                return true;
            }
            if (fs.keyPressed(keyCode)) return true;
        }
        if (dlSearch.isFocused()) {
            if (keyCode == Keys.ESCAPE) {
                dlSearch.setFocused(false);
                return true;
            }
            if (keyCode == Keys.ENTER) {
                dlTyped = 0;
                return true;
            }
            if (dlSearch.keyPressed(keyCode)) {
                dlTyped = System.currentTimeMillis();
                return true;
            }
        }
        if (search.isFocused() || profileName.isFocused()) {
            if (keyCode == Keys.ESCAPE) {
                search.setFocused(false);
                profileName.setFocused(false);
                return true;
            }
            if (keyCode == Keys.ENTER && profileName.isFocused()) {
                saveProfile();
                return true;
            }
            if (search.keyPressed(keyCode) || profileName.keyPressed(keyCode)) {
                if (search.isFocused()) scroll.set(0);
                return true;
            }
        }
        if (keyCode == Keys.ESCAPE) {
            if (page != Page.MODULES) switchPage(Page.MODULES, null);
            else close();
            return true;
        }
        int bound = guiModule().getKeybind().get();
        if (keyCode == bound && page == Page.MODULES) {
            close();
            return true;
        }
        return false;
    }

    @Override
    public boolean charTyped(char chr) {
        TextBox fs = focusedString();
        if (fs != null && fs.charTyped(chr)) return true;
        if (profileName.charTyped(chr)) return true;
        if (dlSearch.charTyped(chr)) {
            dlTyped = System.currentTimeMillis();
            return true;
        }
        if (page == Page.DOWNLOADS && Character.isLetterOrDigit(chr)) {
            dlSearch.setFocused(true);
            dlSearch.charTyped(chr);
            dlTyped = System.currentTimeMillis();
            return true;
        }
        if (search.charTyped(chr)) {
            scroll.set(0);
            return true;
        }
        // start typing anywhere on the modules page to search
        if (page == Page.MODULES && listening == null && Character.isLetterOrDigit(chr)) {
            search.setFocused(true);
            search.charTyped(chr);
            scroll.set(0);
            return true;
        }
        return false;
    }
}
