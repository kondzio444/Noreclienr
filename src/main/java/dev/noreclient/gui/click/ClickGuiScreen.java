package dev.noreclient.gui.click;

import com.mojang.blaze3d.systems.RenderSystem;
import dev.noreclient.NoreClient;
import dev.noreclient.config.ConfigManager;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.widget.TextBox;
import dev.noreclient.gui.widget.Widgets;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.module.client.ClickGuiModule;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.setting.Setting;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.MenuBackground;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

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
public class ClickGuiScreen extends Screen {
    private static final float W = 500, H = 310, SIDEBAR = 124;

    private enum Page { MODULES, SETTINGS, PROFILES }

    private interface ClickAction { void click(double mx, double my, int button); }

    private interface DragAction { void drag(double mx, double my); }

    private record Hit(float x, float y, float w, float h, boolean clipped, ClickAction action) {}

    // remember the last tab between openings
    private static Category lastCategory = null;

    private final Screen parent;
    private final List<Hit> hits = new ArrayList<>();
    private final Map<Object, Animation> anims = new HashMap<>();
    private final TextBox search = new TextBox("Szukaj modułów...", 32);
    private final TextBox profileName = new TextBox("Nazwa profilu", 24);
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

    public ClickGuiScreen(Screen parent) {
        super(Text.literal("Nore Client"));
        this.parent = parent;
    }

    /** Opens the menu directly on the settings page of the given module. */
    public static ClickGuiScreen forModule(Screen parent, Module m) {
        ClickGuiScreen s = new ClickGuiScreen(parent);
        s.page = Page.SETTINGS;
        s.selected = m;
        s.category = m.getCategory();
        return s;
    }

    private Animation anim(Object key, float speed) {
        return anims.computeIfAbsent(key, k -> new Animation(0, speed));
    }

    private ClickGuiModule guiModule() {
        return NoreClient.get().modules().get(ClickGuiModule.class);
    }

    @Override
    public boolean shouldPause() { return false; }

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
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        if (client != null && client.world == null) {
            MenuBackground.render(context, width, height, mouseX, mouseY);
            context.fill(0, 0, width, height, 0x60000000);
        } else if (Theme.blur()) {
            super.renderBackground(context, mouseX, mouseY, delta);
        } else {
            context.fill(0, 0, width, height, 0x90000000);
        }
    }

    @Override
    public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
        float o = open.target(closing ? 0 : 1).update();
        if (!guiModule().openAnimation.isOn() && !closing) open.set(1);
        if (closing && o < 0.02f) {
            client.setScreen(parent);
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
        RenderSystem.setShaderColor(1, 1, 1, alpha);
        ctx.getMatrices().push();
        ctx.getMatrices().scale(scale, scale, 1);
        ctx.getMatrices().translate(ox, oy, 0);

        float r = Theme.radius() * 1.4f;
        Render2D.shadow(ctx, 0, 0, W, H, r, 10, ColorUtil.fade(0xB0000000, o));
        Render2D.roundedRect(ctx, 0, 0, W, H, r, Theme.BG);
        renderSidebar(ctx, mx, my);
        renderHeader(ctx, mx, my);

        clipX = SIDEBAR + 10;
        clipY = 46;
        clipW = W - SIDEBAR - 20;
        clipH = H - 56;
        scroll.update();
        float pa = Animation.easeOutCubic(pageAnim.update());
        enableClip(ctx);
        ctx.getMatrices().push();
        ctx.getMatrices().translate(0, -scroll.get() + (1 - pa) * 10, 0);
        double cmy = my + scroll.get() - (1 - pa) * 10;
        RenderSystem.setShaderColor(1, 1, 1, alpha * pa);
        switch (page) {
            case MODULES -> renderModules(ctx, mx, cmy);
            case SETTINGS -> renderSettings(ctx, mx, cmy);
            case PROFILES -> renderProfiles(ctx, mx, cmy);
        }
        ctx.getMatrices().pop();
        ctx.disableScissor();
        RenderSystem.setShaderColor(1, 1, 1, alpha);
        renderScrollbar(ctx);
        Render2D.roundedOutline(ctx, 0, 0, W, H, r, 1, Theme.OUTLINE);
        ctx.getMatrices().pop();
        RenderSystem.setShaderColor(1, 1, 1, 1);

        if (drag != null) drag.drag(mx, cmyForDrag(my));
        NotificationManager.render(ctx);
    }

    private double cmyForDrag(double my) {
        return my + scroll.get();
    }

    private void enableClip(DrawContext ctx) {
        int x1 = (int) Math.floor((clipX + ox) * scale), y1 = (int) Math.floor((clipY + oy) * scale);
        int x2 = (int) Math.ceil((clipX + clipW + ox) * scale), y2 = (int) Math.ceil((clipY + clipH + oy) * scale);
        ctx.enableScissor(x1, y1, x2, y2);
    }

    private void renderScrollbar(DrawContext ctx) {
        if (contentHeight <= clipH) return;
        float trackH = clipH - 8;
        float barH = Math.max(20, trackH * clipH / contentHeight);
        float maxScroll = contentHeight - clipH;
        float y = clipY + 4 + (trackH - barH) * (scroll.get() / maxScroll);
        Render2D.roundedRect(ctx, W - 7, y, 3, barH, 1.5f, ColorUtil.withAlpha(Theme.accent(), 150));
    }

    private void renderSidebar(DrawContext ctx, double mx, double my) {
        float r = Theme.radius() * 1.4f;
        Render2D.roundedRect(ctx, 0, 0, SIDEBAR, H, r, Theme.SIDEBAR);
        Render2D.rect(ctx, SIDEBAR - r, 0, r, H, Theme.SIDEBAR);
        Render2D.rect(ctx, SIDEBAR, 0, 1, H, Theme.OUTLINE);

        // logo
        Render2D.roundedGradient(ctx, 14, 14, 22, 22, 6, Theme.accent(), Theme.accent2(), true);
        Render2D.scaledText(ctx, "N", 20.5f, 17.5f, 1.6f, 0xFFFFFFFF, true);
        Render2D.gradientText(ctx, "Nore", 42, 14, 1.35f, Theme.accent(), Theme.accent2(), false);
        Render2D.text(ctx, "Client v" + NoreClient.VERSION, 42, 27, Theme.TEXT_MUTED);

        float y = 52;
        Render2D.scaledText(ctx, "MODUŁY", 14, y, 0.7f, Theme.TEXT_MUTED, false);
        y += 9;
        int idx = -1;
        if (page != Page.PROFILES) idx = category == null ? 0 : category.ordinal() + 1;
        navY.target(y + Math.max(0, idx) * 22);
        if (navAlpha.get() < 0.01f && idx >= 0) navY.set(y + idx * 22);
        float na = navAlpha.target(idx >= 0 ? 1 : 0).update();
        float ny = navY.update();
        if (na > 0.01f) {
            Render2D.roundedGradient(ctx, 8, ny, SIDEBAR - 16, 20, Theme.radius(),
                    ColorUtil.withAlpha(Theme.accent(), (int) (70 * na)), ColorUtil.withAlpha(Theme.accent2(), (int) (25 * na)), false);
            Render2D.roundedRect(ctx, 8, ny + 5, 2.5f, 10, 1.25f, ColorUtil.fade(Theme.accent(), na));
        }
        y = navItem(ctx, mx, my, y, null, "Wszystkie", 0xFFFFFFFF, NoreClient.get().modules().getModules());
        for (Category c : Category.values()) {
            y = navItem(ctx, mx, my, y, c, c.displayName, c.color, NoreClient.get().modules().getModules(c));
        }

        // bottom buttons
        float bw = SIDEBAR - 24;
        float by = H - 56;
        boolean hp = Render2D.hovered(mx, my, 12, by, bw, 20);
        Widgets.button(ctx, 12, by, bw, 20, "✎ Edytuj HUD", anim("btn_hud", 14).target(hp ? 1 : 0).update(), true);
        hit(12, by, bw, 20, false, (x, yy, b) -> {
            Sounds.click();
            client.setScreen(new HudEditorScreen(this));
        });
        by += 25;
        boolean pp = Render2D.hovered(mx, my, 12, by, bw, 20) || page == Page.PROFILES;
        Widgets.button(ctx, 12, by, bw, 20, "☰ Profile", anim("btn_prof", 14).target(pp ? 1 : 0).update(), false);
        hit(12, by, bw, 20, false, (x, yy, b) -> switchPage(Page.PROFILES, null));
    }

    private float navItem(DrawContext ctx, double mx, double my, float y, Category c, String label, int color, List<Module> mods) {
        boolean active = page != Page.PROFILES && category == c && (page == Page.MODULES || selected != null);
        boolean hov = Render2D.hovered(mx, my, 8, y, SIDEBAR - 16, 20);
        float a = anim("nav_" + label, 14).target(active ? 1 : hov ? 0.6f : 0).update();
        if (hov && !active) Render2D.roundedRect(ctx, 8, y, SIDEBAR - 16, 20, Theme.radius(), 0x10FFFFFF);
        float shift = a * 3;
        Render2D.circle(ctx, 20 + shift, y + 10, 3 + (active ? 0.6f : 0), color);
        Render2D.text(ctx, label, 29 + shift, y + 6, ColorUtil.lerp(Theme.TEXT_DIM, Theme.TEXT, Math.max(a, active ? 1 : 0)));
        long on = mods.stream().filter(m -> m.isEnabled() && m.isToggleable()).count();
        String cnt = String.valueOf(on);
        Render2D.text(ctx, cnt, SIDEBAR - 16 - Render2D.textWidth(cnt), y + 6, on > 0 ? Theme.accent() : Theme.TEXT_MUTED);
        hit(8, y, SIDEBAR - 16, 20, false, (x, yy, b) -> {
            category = c;
            lastCategory = c;
            switchPage(Page.MODULES, null);
        });
        return y + 22;
    }

    private void renderHeader(DrawContext ctx, double mx, double my) {
        float x = SIDEBAR + 12;
        String title, sub;
        if (page == Page.SETTINGS && selected != null) {
            boolean hb = Render2D.hovered(mx, my, x, 12, 20, 20);
            float ha = anim("back", 14).target(hb ? 1 : 0).update();
            Render2D.roundedRect(ctx, x, 12, 20, 20, Theme.radius(), ColorUtil.lerp(Theme.CARD, Theme.CARD_HOVER, ha));
            Render2D.centeredText(ctx, "←", x + 10, 18, ColorUtil.lerp(Theme.TEXT_DIM, Theme.TEXT, ha), false);
            hit(x, 12, 20, 20, false, (a, b, c) -> switchPage(Page.MODULES, null));
            x += 28;
            title = selected.getName();
            sub = selected.getDescription();
        } else if (page == Page.PROFILES) {
            title = "Profile";
            sub = "Zapisuj i wczytuj konfiguracje (aktywny: " + NoreClient.get().config().getActiveProfile() + ")";
        } else if (!search.getText().isBlank()) {
            title = "Wyniki wyszukiwania";
            sub = NoreClient.get().modules().search(search.getText()).size() + " pasujących modułów";
        } else {
            title = category == null ? "Wszystkie moduły" : category.displayName;
            sub = category == null ? NoreClient.get().modules().getModules().size() + " modułów" : category.subtitle;
        }
        Render2D.scaledText(ctx, title, x, 12, 1.3f, Theme.TEXT, false);
        Render2D.text(ctx, Render2D.trim(sub, (int) (W - x - 170)), x, 26, Theme.TEXT_MUTED);

        if (page == Page.MODULES) {
            float sw = 150, sx = W - sw - 12;
            search.render(ctx, sx, 12, sw, 22, TextBox.SEARCH_ICON);
            hit(sx, 12, sw, 22, false, (a, b, c) -> {
                search.setFocused(true);
                profileName.setFocused(false);
            });
        }
    }

    // ------------------------------------------------------------------ modules page

    private void renderModules(DrawContext ctx, double mx, double my) {
        List<Module> list;
        if (!search.getText().isBlank()) list = NoreClient.get().modules().search(search.getText());
        else if (category == null) list = NoreClient.get().modules().getModules();
        else list = NoreClient.get().modules().getModules(category);

        int cols = 3;
        float gap = 8;
        float cw = (clipW - gap * (cols - 1)) / cols;
        float ch = guiModule().showDescriptions.isOn() ? 58 : 42;
        float startY = clipY + 2;
        if (list.isEmpty()) {
            Render2D.centeredText(ctx, "Brak wyników dla \"" + search.getText() + "\"", clipX + clipW / 2f, clipY + 40, Theme.TEXT_MUTED, false);
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
                RenderSystem.setShaderColor(1, 1, 1, alpha * Math.max(0, p));
                ctx.getMatrices().push();
                ctx.getMatrices().translate(0, (1 - p) * 14, 0);
                renderCard(ctx, mx, my - (1 - p) * 14, m, x, y, cw, ch);
                ctx.getMatrices().pop();
                RenderSystem.setShaderColor(1, 1, 1, alpha);
            } else {
                renderCard(ctx, mx, my, m, x, y, cw, ch);
            }
        }
        int rows = (list.size() + cols - 1) / cols;
        contentHeight = rows * (ch + gap) + 4;
    }

    private void renderCard(DrawContext ctx, double mx, double my, Module m, float x, float y, float w, float h) {
        if (y > clipY + scroll.get() + clipH + 10 || y + h < clipY + scroll.get() - 10) {
            hit(x, y, w, h, true, cardAction(m, x, y, w, h));
            return;
        }
        boolean hov = hovered(mx, my, x, y, w, h, true);
        float ha = anim(m.getName() + "_hover", 14).target(hov ? 1 : 0).update();
        float ta = anim(m.getName() + "_on", 14).target(m.isEnabled() ? 1 : 0).update();
        float r = Theme.radius();

        if (ta > 0.01f && m.isToggleable()) Render2D.shadow(ctx, x, y, w, h, r, 4, ColorUtil.withAlpha(Theme.accent(), (int) (60 * ta)));
        Render2D.roundedRect(ctx, x, y - ha, w, h, r, ColorUtil.lerp(Theme.CARD, Theme.CARD_HOVER, ha));
        int outline = m.isToggleable() ? ColorUtil.lerp(Theme.OUTLINE, ColorUtil.withAlpha(Theme.accent(), 200), ta) : Theme.OUTLINE;
        Render2D.roundedOutline(ctx, x, y - ha, w, h, r, 1, outline);
        float yy = y - ha;

        Render2D.circle(ctx, x + 10, yy + 11, 3, m.getCategory().color);
        Render2D.text(ctx, Render2D.trim(m.getName(), (int) w - 24), x + 17, yy + 7, Theme.TEXT);
        if (guiModule().showDescriptions.isOn()) {
            String d = m.getDescription();
            // wrap description into two lines max (scaled 0.8)
            int maxW = (int) ((w - 16) / 0.8f);
            String l1 = d, l2 = "";
            if (Render2D.textWidth(d) > maxW) {
                int cut = d.length();
                while (cut > 0 && Render2D.textWidth(d.substring(0, cut)) > maxW) cut = d.lastIndexOf(' ', cut - 1);
                if (cut <= 0) cut = Math.min(d.length(), 20);
                l1 = d.substring(0, cut);
                l2 = Render2D.trim(d.substring(cut).trim(), maxW);
            }
            Render2D.scaledText(ctx, l1, x + 8, yy + 20, 0.8f, Theme.TEXT_DIM, false);
            if (!l2.isEmpty()) Render2D.scaledText(ctx, l2, x + 8, yy + 28, 0.8f, Theme.TEXT_DIM, false);
        }

        float by = yy + h - 18;
        // settings "gear" area
        boolean hasSettings = m.isToggleable();
        if (hasSettings) {
            boolean gh = hovered(mx, my, x + 6, by, 50, 14, true);
            float ga = anim(m.getName() + "_gear", 16).target(gh ? 1 : 0).update();
            int gc = ColorUtil.lerp(Theme.TEXT_MUTED, Theme.accent(), ga);
            // "sliders" icon: three lines with knobs
            for (int k = 0; k < 3; k++) {
                float ly = by + 3.5f + k * 3;
                Render2D.rect(ctx, x + 8, ly, 9, 1, gc);
                float knob = (k == 1 ? 6 : 2) + (k == 1 ? -4 : 4) * ga;
                Render2D.circle(ctx, x + 8 + knob, ly + 0.5f, 1.3f, gc);
            }
            Render2D.text(ctx, "Opcje", x + 21 + ga * 1.5f, by + 3, gc);
        }
        if (m.isToggleable()) {
            Widgets.toggle(ctx, x + w - 32, by, 26, 13, ta);
        } else {
            Render2D.text(ctx, "Otwórz ›", x + w - 8 - Render2D.textWidth("Otwórz ›"), by + 3, Theme.accent());
        }
        if (m.getKeybind().isBound()) {
            String k = m.getKeybind().getKeyName();
            float kw = Render2D.textWidth(k) * 0.75f + 8;
            float kx = x + w - (m.isToggleable() ? 38 : 8 + Render2D.textWidth("Otwórz ›") + 6) - kw;
            Render2D.roundedRect(ctx, kx, by + 1, kw, 11, 3, 0x26FFFFFF);
            Render2D.scaledText(ctx, k, kx + 4, by + 3.5f, 0.75f, Theme.TEXT_DIM, false);
        }
        hit(x, y, w, h, true, cardAction(m, x, y, w, h));
    }

    private ClickAction cardAction(Module m, float x, float y, float w, float h) {
        return (cx, cy, button) -> {
            boolean onOptions = cx < x + 56 && cy > y + h - 20;
            if (button == 1 || !m.isToggleable() || onOptions) {
                switchPage(Page.SETTINGS, m);
            } else if (button == 0) {
                m.toggle();
                Sounds.toggle(m.isEnabled());
            }
        };
    }

    // ------------------------------------------------------------------ settings page

    private void renderSettings(DrawContext ctx, double mx, double my) {
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
            if (s instanceof BooleanSetting b) y = boolRow(ctx, x, y, w, b, mx, my);
            else if (s instanceof NumberSetting n) y = numberRow(ctx, x, y, w, n, mx, my);
            else if (s instanceof ModeSetting md) y = modeRow(ctx, x, y, w, md, mx, my);
            else if (s instanceof ColorSetting c) y = colorRow(ctx, x, y, w, c, mx, my);
            else if (s instanceof KeybindSetting k) y = keybindRow(ctx, x, y, w, k, mx, my);
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

    private float row(DrawContext ctx, float x, float y, float w, float h, String name, String desc, double mx, double my) {
        boolean hov = hovered(mx, my, x, y, w, h, true);
        float ha = anim("row_" + (selected == null ? "" : selected.getName()) + name, 16).target(hov ? 1 : 0).update();
        Render2D.roundedRect(ctx, x, y, w, h - 4, Theme.radius(), ColorUtil.lerp(Theme.PANEL, Theme.CARD, ha));
        Render2D.text(ctx, name, x + 9, y + 5, Theme.TEXT);
        Render2D.scaledText(ctx, Render2D.trim(desc, 300), x + 9, y + 16, 0.75f, Theme.TEXT_MUTED, false);
        return y + h;
    }

    private float boolRow(DrawContext ctx, float x, float y, float w, BooleanSetting s, double mx, double my) {
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

    private float numberRow(DrawContext ctx, float x, float y, float w, NumberSetting s, double mx, double my) {
        float top = y;
        y = row(ctx, x, y, w, 30, s.getName(), s.getDescription(), mx, my);
        float sw = 130, sx = x + w - sw - 12, sy = top + 12;
        double range = s.getMax() - s.getMin();
        float target = (float) ((s.get() - s.getMin()) / range);
        float p = anim(s, 18).target(target).update();
        Render2D.roundedRect(ctx, sx, sy, sw, 4, 2, 0xFF2C3044);
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

    private float modeRow(DrawContext ctx, float x, float y, float w, ModeSetting s, double mx, double my) {
        float top = y;
        y = row(ctx, x, y, w, 30, s.getName(), s.getDescription(), mx, my);
        float pw = 110, px = x + w - pw - 10, py = top + 5;
        boolean hov = hovered(mx, my, px, py, pw, 16, true);
        Render2D.roundedRect(ctx, px, py, pw, 16, 8, hov ? Theme.CARD_HOVER : 0xFF262A3B);
        Render2D.text(ctx, "‹", px + 6, py + 4, hov ? Theme.accent() : Theme.TEXT_MUTED);
        Render2D.text(ctx, "›", px + pw - 10, py + 4, hov ? Theme.accent() : Theme.TEXT_MUTED);
        Animation slide = anim("mode_" + s.hashCode(), 16);
        slide.update();
        float sv = slide.get();
        ctx.enableScissor((int) ((px + 14 + ox) * scale), (int) ((py + oy - scroll.get()) * scale),
                (int) ((px + pw - 14 + ox) * scale), (int) ((py + 16 + oy - scroll.get()) * scale));
        Render2D.centeredText(ctx, Render2D.trim(s.get(), (int) pw - 26), px + pw / 2f + sv * 30, py + 4,
                ColorUtil.fade(Theme.TEXT, 1 - Math.abs(sv)), false);
        ctx.disableScissor();
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

    private float colorRow(DrawContext ctx, float x, float y, float w, ColorSetting s, double mx, double my) {
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
                ctx.enableScissor((int) ((sqx + ox) * scale), (int) ((top + 26 + oy - scroll.get()) * scale),
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
                ctx.disableScissor();

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

    private float keybindRow(DrawContext ctx, float x, float y, float w, KeybindSetting s, double mx, double my) {
        float top = y;
        y = row(ctx, x, y, w, 30, s.getName(), "Kliknij i naciśnij klawisz (ESC = anuluj, DEL = usuń)", mx, my);
        boolean isListening = listening == s;
        String label = isListening ? "Naciśnij klawisz..." : s.getKeyName();
        float bw = Math.max(60, Render2D.textWidth(label) + 16), bx = x + w - bw - 10;
        float la = anim(s, 14).target(isListening ? 1 : 0).update();
        Render2D.roundedRect(ctx, bx, top + 5, bw, 16, Theme.radius(), ColorUtil.lerp(0xFF262A3B, ColorUtil.withAlpha(Theme.accent(), 120), la));
        Render2D.centeredText(ctx, label, bx + bw / 2f, top + 9, isListening ? Theme.TEXT : Theme.TEXT_DIM, false);
        hit(x, top, w, 26, true, (a, b, button) -> {
            if (button == 1) {
                s.set(GLFW.GLFW_KEY_UNKNOWN);
                listening = null;
            } else {
                listening = isListening ? null : s;
            }
            Sounds.click();
        });
        return y;
    }

    // ------------------------------------------------------------------ profiles page

    private void renderProfiles(DrawContext ctx, double mx, double my) {
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
        return super.mouseReleased(mouseX, mouseY, button);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
        float max = Math.max(0, contentHeight - clipH);
        float t = (float) Math.max(0, Math.min(max, scroll.getTarget() - verticalAmount * 28));
        scroll.target(t);
        return true;
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (listening != null) {
            if (keyCode == GLFW.GLFW_KEY_ESCAPE) listening = null;
            else if (keyCode == GLFW.GLFW_KEY_DELETE || keyCode == GLFW.GLFW_KEY_BACKSPACE) {
                listening.set(GLFW.GLFW_KEY_UNKNOWN);
                listening = null;
            } else {
                listening.set(keyCode);
                listening = null;
            }
            Sounds.click();
            return true;
        }
        if (search.isFocused() || profileName.isFocused()) {
            if (keyCode == GLFW.GLFW_KEY_ESCAPE) {
                search.setFocused(false);
                profileName.setFocused(false);
                return true;
            }
            if (keyCode == GLFW.GLFW_KEY_ENTER && profileName.isFocused()) {
                saveProfile();
                return true;
            }
            if (search.keyPressed(keyCode) || profileName.keyPressed(keyCode)) {
                if (search.isFocused()) scroll.set(0);
                return true;
            }
        }
        if (keyCode == GLFW.GLFW_KEY_ESCAPE) {
            if (page != Page.MODULES) switchPage(Page.MODULES, null);
            else close();
            return true;
        }
        int bound = guiModule().getKeybind().get();
        if (keyCode == bound && page == Page.MODULES) {
            close();
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean charTyped(char chr, int modifiers) {
        if (profileName.charTyped(chr)) return true;
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
        return super.charTyped(chr, modifiers);
    }
}
