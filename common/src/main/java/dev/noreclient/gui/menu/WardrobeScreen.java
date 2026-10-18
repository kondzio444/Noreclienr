package dev.noreclient.gui.menu;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.TextureRef;
import dev.noreclient.cosmetic.Item;
import dev.noreclient.cosmetic.Items;
import dev.noreclient.cosmetic.Look;
import dev.noreclient.cosmetic.Mini3D;
import dev.noreclient.cosmetic.SecretEars;
import dev.noreclient.cosmetic.Slot;
import dev.noreclient.cosmetic.Wardrobe;
import dev.noreclient.cosmetic.Worn;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.gui.widget.Widgets;
import dev.noreclient.module.social.Cosmetics;
import dev.noreclient.util.Animation;
import dev.noreclient.util.Capes;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

import java.util.List;

/**
 * The wardrobe ("Szatnia"): categories on the left, the items of the category as live 3D tiles,
 * the options of the worn item (colour, variant, animation, speed, size, glow) below them and a big
 * preview of the player wearing the look on the right (drag to turn it, pick a pose to see how the
 * items move). Every change is worn immediately, saved and published to other Nore players.
 */
public class WardrobeScreen extends PanelScreen {
    private static final Slot[] CATS = Slot.values();
    private static final String[] POSES = {"Stój", "Chodź", "Leć", "Skradaj"};
    private static Slot lastCat = Slot.WINGS;

    private Slot cat = lastCat;
    private final Animation catAnim = new Animation(0, 9);
    private final Animation optsAnim = new Animation(0, 10);
    private final Animation yawAnim = new Animation(200, 6);
    private float dragYaw = 200;
    private boolean autoSpin = true;
    private long lastDrag;
    private long catSwitched = System.currentTimeMillis();
    private long reveal;
    private String shake;
    private long shakeAt;
    // drags: 0 none, 1 preview, 2 speed, 3 scale, 4 hue, 5 shade
    private int drag;
    private float dragStartX, dragStartYaw;
    private float pvX, pvY, pvW, pvH;
    private float[] speedBar, scaleBar, hueBar, shadeBar;
    private String tooltip, notice;
    private long noticeAt;
    private float tipX, tipY;

    public WardrobeScreen(Object parent) {
        super(parent);
        if (SecretEars.justUnlocked) {
            cat = Slot.EARS;
            reveal = System.currentTimeMillis();
        }
        faceFor(cat, false);
    }

    private Cosmetics module() { return NoreClient.get().modules().get(Cosmetics.class); }

    @Override protected String title() { return "SZATNIA"; }

    @Override protected String subtitle() { return "Peleryny, skrzydła, czapki, uszy, ogony i aury • widzą je inni gracze Nore (F5)"; }

    private static Look look() { return Wardrobe.localLook(); }

    private void wear(Slot s, Worn w, boolean persist) {
        Wardrobe.setLocalLook(look().with(s, w), persist);
    }

    /** Turns the preview towards the side where the category's items are (the back for wings, tails, capes). */
    private void faceFor(Slot s, boolean animate) {
        float target = s == Slot.WINGS || s == Slot.TAIL || s == Slot.CAPE ? 200 : 25;
        float shown = yawAnim.get() + spinPhase;
        // take the short way round
        while (target - shown > 180) target -= 360;
        while (target - shown < -180) target += 360;
        dragYaw = target - spinPhase;
        if (!animate) yawAnim.set(dragYaw);
    }

    @Override
    protected void headerButtons(Gfx g, int mx, int my, float right, float y) {
        final Cosmetics c = module();
        String label = c.isEnabled() ? "Kosmetyki: włączone" : "Kosmetyki: wyłączone";
        float w = buttonWidth(label);
        button(g, mx, my, right - w, y, label, c.isEnabled() ? 3 : 2, true, () -> {
            c.setEnabled(!c.isEnabled());
            NoreClient.get().config().save();
        });
    }

    @Override
    protected void content(Gfx g, int mx, int my, float x, float y, float w, float h) {
        tooltip = null;
        Wardrobe.previewLook = look();
        float railW = 78;
        float pw = Math.max(120, Math.min(200, w * 0.32f));
        float gx = x + railW + 8, gw = w - railW - pw - 16;
        rail(g, mx, my, x, y, railW, h);
        preview(g, mx, my, x + w - pw, y, pw, h);
        // options panel for the worn item of this category
        Worn worn = look().get(cat);
        Item item = worn == null ? null : Items.get(worn.id);
        if (item != null && item.secret && !SecretEars.unlocked()) item = null; // still locked: as if nothing is worn
        boolean showOpts = item != null && !(item instanceof Items.CapeItem && !item.animOption);
        float oa = optsAnim.target(showOpts ? 1 : 0).update();
        float optH = item == null ? 0 : optionsHeight(item, gw);
        float gridH = h - optH * oa - (oa > 0.01f ? 8 * oa : 0);
        grid(g, mx, my, gx, y, gw, gridH);
        if (oa > 0.01f && item != null) {
            g.setAlpha(g.getAlpha() * oa);
            options(g, mx, my, gx, y + gridH + 8 * oa, gw, optH, item, worn);
            g.setAlpha(1);
        }
        if (tooltip != null) drawTooltip(g, tooltip, tipX, tipY);
    }

    // ------------------------------------------------------------------ categories

    private void rail(Gfx g, int mx, int my, float x, float y, float w, float h) {
        panel(g, x, y, w, h, null);
        float ry = y + 6;
        for (int i = 0; i < CATS.length; i++) {
            final Slot s = CATS[i];
            float st = intro(60L * i);
            float rh = 22, rx = x + 4 - (1 - st) * 10;
            boolean sel = s == cat;
            boolean hov = Render2D.hovered(mx, my, x + 4, ry, w - 8, rh);
            float a = anim("cat" + i).target(sel ? 1 : hov ? 0.5f : 0).update();
            if (a > 0.01f) Widgets.glowBox(g, rx, ry, w - 8, rh, Theme.radius(), Theme.accent(), a, 0.4f + 0.6f * a);
            int col = ColorUtil.lerp(Theme.TEXT_DIM, 0xFFFFFFFF, a);
            catIcon(g, s, rx + 11, ry + rh / 2f, col);
            Render2D.text(g, s.title, rx + 21, ry + 7, col, false);
            Worn worn = look().get(s);
            if (worn != null) Render2D.circle(g, rx + 16, ry + 5, 1.8f, Theme.SUCCESS);
            hit(x + 4, ry, w - 8, rh, () -> {
                if (cat != s) {
                    Sounds.click();
                    cat = lastCat = s;
                    catSwitched = System.currentTimeMillis();
                    scrollTarget = 0;
                    faceFor(s, true);
                }
            });
            ry += rh + 3;
        }
        // footer: how many things are worn
        int count = look().slots().size();
        String f = count == 0 ? "Nic nie nosisz" : "Założone: " + count;
        Render2D.scaledText(g, f, x + 7, y + h - 12, 0.7f, Theme.TEXT_MUTED, false);
    }

    private static void catIcon(Gfx g, Slot s, float cx, float cy, int col) {
        switch (s) {
            case CAPE:
                Render2D.roundedOutline(g, cx - 3, cy - 4.5f, 6, 9, 1, 1.1f, col);
                Render2D.rect(g, cx - 4, cy - 4.5f, 8, 1.2f, col);
                break;
            case WINGS:
                for (int k = -1; k <= 1; k += 2) {
                    g.mesh(Gfx.TRIANGLES, new float[]{cx + k * 0.8f, cy - 2, cx + k * 5, cy - 4, cx + k * 3.5f, cy + 3.5f}, new int[]{col, col, col}, 3);
                }
                break;
            case HAT:
                g.mesh(Gfx.TRIANGLES, new float[]{cx - 3, cy + 2, cx + 1.5f, cy - 5, cx + 3, cy + 2}, new int[]{col, col, col}, 3);
                Render2D.rect(g, cx - 5, cy + 2, 10, 1.4f, col);
                break;
            case EARS:
                SecretEars.catIcon(g, cx, cy + 1, 0.85f, col, 0);
                break;
            case TAIL:
                float px = cx - 4, py = cy + 3;
                for (int k = 1; k <= 8; k++) {
                    float t = k / 8f;
                    float nx = cx - 4 + t * 8, ny = cy + 3 - (float) Math.sin(t * Math.PI * 1.2) * 5;
                    Render2D.line(g, px, py, nx, ny, 1.4f - t * 0.5f, col);
                    px = nx;
                    py = ny;
                }
                break;
            default:
                Render2D.ring(g, cx, cy - 2, 3.5f, 1.1f, 0, 360, col);
                Icons.sparkle(g, cx + 3, cy + 3, 2.2f, col);
                break;
        }
    }

    // ------------------------------------------------------------------ items

    private void grid(Gfx g, int mx, int my, float x, float y, float w, float h) {
        List<Item> items = Items.of(cat);
        int count = items.size() + 1; // + "nothing"
        int cols = Math.max(2, (int) ((w + 6) / 64));
        float cw = (w - (cols - 1) * 6) / cols, ch = cw + 14;
        viewH = h;
        contentH = ((count + cols - 1) / cols) * (ch + 6) - 6;
        float sc = scrolled();
        float ca = catAnim.get();
        if (System.currentTimeMillis() - catSwitched < 30) catAnim.set(0);
        ca = catAnim.target(1).update();
        Worn worn = look().get(cat);
        Item wornItem = worn == null ? null : Items.get(worn.id);
        if (wornItem != null && wornItem.secret && !SecretEars.unlocked()) worn = null;
        boolean revealing = reveal != 0 && System.currentTimeMillis() - reveal < 2600;
        if (reveal != 0 && !revealing) { reveal = 0; SecretEars.justUnlocked = false; }
        g.scissor((int) x - 6, (int) y, (int) (x + w + 6), (int) (y + h));
        for (int i = 0; i < count; i++) {
            int col = i % cols, row = i / cols;
            float tx = x + col * (cw + 6), ty = y + row * (ch + 6) - sc;
            if (ty + ch < y || ty > y + h) continue;
            float st = Animation.easeOutCubic(Math.min(1, ca * 1.6f - Math.min(i, 10) * 0.06f));
            if (st <= 0) continue;
            ty += (1 - st) * 14;
            final Item item = i == 0 ? null : items.get(i - 1);
            boolean locked = item != null && item.secret && !SecretEars.unlocked();
            boolean sel = item == null ? worn == null : worn != null && worn.id.equals(item.id);
            boolean hov = Render2D.hovered(mx, my, tx, ty, cw, ch) && my >= y && my < y + h;
            float a = anim("t" + cat.id + i).target(hov ? 1 : 0).update();
            float shakeX = 0;
            String key = item == null ? "none" : item.id;
            if (key.equals(shake) && System.currentTimeMillis() - shakeAt < 450) {
                float p = (System.currentTimeMillis() - shakeAt) / 450f;
                shakeX = (float) Math.sin(p * Math.PI * 7) * 3 * (1 - p);
            }
            g.setAlpha(st);
            g.push();
            g.translate(shakeX, -a * 2);
            float r = Theme.radius();
            if (sel || a > 0.01f) Render2D.shadow(g, tx, ty, cw, ch, r, 5, ColorUtil.withAlpha(Theme.accent(), (int) ((sel ? 70 : 0) + 50 * a)));
            int bg = locked ? ColorUtil.lerp(0xB00C0A12, 0xC8141020, a) : ColorUtil.lerp(0xB0160F26, 0xD0201634, a);
            Render2D.roundedRect(g, tx, ty, cw, ch, r, bg);
            Render2D.roundedOutline(g, tx, ty, cw, ch, r, 1, sel ? ColorUtil.withAlpha(Theme.accent(), 230) : ColorUtil.lerp(0x20FFFFFF, ColorUtil.withAlpha(Theme.accent(), 140), a));
            float px = tx + 3, py = ty + 3, pw = cw - 6, ph = cw - 8;
            String name;
            if (item == null) {
                name = "Brak";
                Render2D.ring(g, px + pw / 2f, py + ph / 2f, Math.min(pw, ph) * 0.24f, 1.4f, 0, 360, 0x50FFFFFF);
                Render2D.line(g, px + pw / 2f - ph * 0.17f, py + ph / 2f + ph * 0.17f, px + pw / 2f + ph * 0.17f, py + ph / 2f - ph * 0.17f, 1.4f, 0x60FF6B6B);
            } else if (locked) {
                name = "???";
                lockedTile(g, px, py, pw, ph, a);
            } else {
                name = item.name;
                tilePreview(g, item, sel ? worn : Worn.of(item), px, py, pw, ph, a, hov);
                if (revealing && item.secret) {
                    float p = (System.currentTimeMillis() - reveal) / 2600f;
                    float flash = (float) Math.max(0, Math.sin(Math.min(1, p * 1.6f) * Math.PI));
                    Render2D.roundedRect(g, tx, ty, cw, ch, r, ColorUtil.withAlpha(0xFFFFFFFF, (int) (120 * flash)));
                    Icons.sparkle(g, tx + cw * 0.2f, ty + 8 + p * 6, 3 * flash, Theme.accent2());
                    Icons.sparkle(g, tx + cw * 0.8f, ty + ch * 0.6f - p * 6, 4 * flash, 0xFFFFE08A);
                }
                if (item.secret) {
                    Render2D.roundedRect(g, tx + 4, ty + 4, 30, 9, 3, 0xE63A1458);
                    Render2D.scaledText(g, "SEKRET", tx + 7.5f, ty + 6.5f, 0.55f, 0xFFFFC2E0, false);
                } else if (item instanceof Items.CapeItem && Capes.collection(item.name) != null) {
                    String badge = Capes.collection(item.name);
                    boolean halloween = Capes.isHalloween(item.name);
                    float bw = Render2D.textWidth(badge) * 0.55f + 7;
                    Render2D.roundedRect(g, tx + 4, ty + 4, bw, 9, 3, halloween ? 0xE63A1458 : ColorUtil.withAlpha(0xFFFFC23D, 210));
                    Render2D.scaledText(g, badge, tx + 7.5f, ty + 6.5f, 0.55f, halloween ? 0xFFFFB547 : 0xFF2A1A08, false);
                }
            }
            tileName(g, name, tx + cw / 2f, ty + ch - 17, cw - 6, sel ? Theme.accent2() : locked ? Theme.TEXT_MUTED : Theme.TEXT);
            if (sel) {
                Render2D.circle(g, tx + cw - 8, ty + 8, 4, Theme.SUCCESS);
                Render2D.line(g, tx + cw - 10, ty + 8, tx + cw - 8.5f, ty + 9.5f, 1.1f, 0xFF0E2A1E);
                Render2D.line(g, tx + cw - 8.5f, ty + 9.5f, tx + cw - 5.8f, ty + 6.5f, 1.1f, 0xFF0E2A1E);
            }
            g.pop();
            g.setAlpha(1);
            if (hov && item != null) {
                tooltip = locked ? "Zablokowane. Podobno coś miauczy w menu głównym…" : item.description;
                tipX = mx;
                tipY = my;
            }
            if (ty >= y - 2 && ty + ch <= y + h + ch * 0.6f) {
                final boolean lk = locked;
                final String k = key;
                hit(tx, Math.max(y, ty), cw, Math.min(ch, y + h - Math.max(y, ty)), () -> {
                    if (lk) {
                        shake = k;
                        shakeAt = System.currentTimeMillis();
                        Sounds.toggle(false);
                        return;
                    }
                    Sounds.click();
                    if (item == null) wear(cat, null, true);
                    else {
                        Worn cur = look().get(cat);
                        if (cur != null && cur.id.equals(item.id)) return;
                        // ears and hats do not fit together: wearing one takes the other off
                        Slot other = cat == Slot.EARS ? Slot.HAT : cat == Slot.HAT ? Slot.EARS : null;
                        Look l = look().with(cat, Worn.of(item));
                        if (other != null && l.get(other) != null) {
                            l = l.with(other, null);
                            notice = other == Slot.HAT ? "Zdjęto czapkę – uszy się pod nią nie mieszczą" : "Zdjęto uszy – czapka by je przygniotła";
                            noticeAt = System.currentTimeMillis();
                        }
                        Wardrobe.setLocalLook(l, true);
                    }
                });
            }
        }
        g.endScissor();
        if (notice != null) {
            long age = System.currentTimeMillis() - noticeAt;
            if (age > 3500) notice = null;
            else {
                float na = Math.min(1, Math.min(age / 200f, (3500 - age) / 400f));
                float nw = Render2D.textWidth(notice) * 0.75f + 14, nx = x + (w - nw) / 2f, ny = y + h - 18 + (1 - na) * 6;
                g.setAlpha(na);
                Render2D.roundedRect(g, nx, ny, nw, 14, 5, 0xF0201634);
                Render2D.roundedOutline(g, nx, ny, nw, 14, 5, 1, ColorUtil.withAlpha(Theme.accent2(), 150));
                Render2D.scaledText(g, notice, nx + 7, ny + 4, 0.75f, Theme.TEXT, false);
                g.setAlpha(1);
            }
        }
        if (contentH > viewH) {
            float barH = Math.max(16, h * h / contentH), barY = y + (h - barH) * (sc / Math.max(1, contentH - viewH));
            Render2D.roundedRect(g, x + w + 2, barY, 2, barH, 1, 0x50FFFFFF);
        }
    }

    /** Item name under a tile: one or two lines of small text. */
    private static void tileName(Gfx g, String name, float cx, float y, float maxW, int color) {
        float sc = 0.72f;
        if (Render2D.textWidth(name) * sc <= maxW) {
            Render2D.scaledText(g, name, cx - Render2D.textWidth(name) * sc / 2f, y + 4, sc, color, false);
            return;
        }
        int sp = name.indexOf(' ');
        String a = sp < 0 ? name : name.substring(0, sp), b = sp < 0 ? "" : name.substring(sp + 1);
        b = Render2D.trim(b, (int) (maxW / sc));
        Render2D.scaledText(g, a, cx - Render2D.textWidth(a) * sc / 2f, y, sc, color, false);
        Render2D.scaledText(g, b, cx - Render2D.textWidth(b) * sc / 2f, y + 7.5f, sc, color, false);
    }

    private void tilePreview(Gfx g, Item item, Worn worn, float x, float y, float w, float h, float hover, boolean hov) {
        if (item instanceof Items.CapeItem) {
            String name = ((Items.CapeItem) item).capeName;
            TextureRef t = Capes.preview(name, worn.anim ? (int) (System.currentTimeMillis() / 150 % Capes.FRAMES) : 0);
            float ch = h - 4, cw = ch * 10 / 16f;
            float cx = x + (w - cw) / 2f, cy = y + 2 - hover * 1;
            Render2D.shadow(g, cx, cy, cw, ch, 2, 4, 0x80000000);
            if (t != null) Render2D.texture(g, t, cx, cy, cw, ch, g.getAlpha());
            else Mini3D.loading(g, x + w / 2f, y + h / 2f, 5, Theme.TEXT_MUTED);
            return;
        }
        float t = (System.currentTimeMillis() % 3_600_000L) / 1000f;
        boolean back = item.slot == Slot.WINGS || item.slot == Slot.TAIL;
        float yaw = (back ? 180 : 0) + 28 * (float) Math.sin(t * 0.6f + item.id.hashCode() % 7) + (hov ? t * 70 % 360 : 0);
        Render2D.radial(g, x + w / 2f, y + h * 0.55f, w * 0.48f, ColorUtil.withAlpha(Theme.accent(), (int) (26 + 30 * hover)), 0);
        if (!Mini3D.item(g, item, worn, x + 2, y + 2, w - 4, h - 4, yaw, 12, g.getAlpha())) {
            Mini3D.loading(g, x + w / 2f, y + h / 2f, 5, Theme.TEXT_MUTED);
        }
    }

    private void lockedTile(Gfx g, float x, float y, float w, float h, float hover) {
        float t = System.currentTimeMillis() / 1000f;
        float cx = x + w / 2f, cy = y + h / 2f;
        // a faint shimmer running over a question mark and a padlock
        Render2D.radial(g, cx, cy, w * 0.45f, ColorUtil.withAlpha(0xFF6B4A9A, (int) (30 + 25 * Math.sin(t * 2))), 0);
        Render2D.scaledText(g, "?", cx - Render2D.textWidth("?") * 1.4f, cy - 10, 2.8f, ColorUtil.withAlpha(Theme.TEXT_MUTED, 150), false);
        Render2D.roundedOutline(g, cx + 5, cy + 4, 8, 6, 1.5f, 1, Theme.TEXT_MUTED);
        Render2D.ring(g, cx + 9, cy + 4, 2.6f, 1, 180, 360, Theme.TEXT_MUTED);
        float sx = x + ((t * 0.5f) % 1.6f - 0.3f) * w;
        if (sx > x && sx < x + w - 4) Render2D.quadGradient(g, sx, y, 4, h, 0, 0x18FFFFFF, 0x18FFFFFF, 0);
    }

    // ------------------------------------------------------------------ options of the worn item

    private void options(Gfx g, int mx, int my, float x, float y, float w, float h, final Item item, final Worn worn) {
        panel(g, x, y, w, h, null);
        float pad = 7, cx = x + pad, cy = y + 6;
        Render2D.text(g, item.name, cx, cy, Theme.TEXT, false);
        String sub = item.variants.length > 0 ? item.variantName(worn.variant) : item.description;
        float bw = buttonWidth("Zdejmij");
        float subX = cx + Render2D.textWidth(item.name) + 6, subW = x + w - pad - bw - 6 - subX;
        if (subW > 20) Render2D.scaledText(g, Render2D.trim(sub, (int) (subW / 0.7f)), subX, cy + 1.5f, 0.7f, Theme.TEXT_MUTED, false);
        button(g, mx, my, x + w - bw - pad, y + 4, "Zdejmij", 2, true, () -> wear(cat, null, true));
        cy += 16;
        if (item instanceof Items.CapeItem) {
            toggle(g, mx, my, cx, cy, "Animacja", worn.anim, () -> wear(cat, worn.withAnim(!worn.anim), true));
            return;
        }
        // colour: palette swatches and a custom hue / shade
        if (item.colorOption) {
            Render2D.scaledText(g, "Kolor", cx, cy + 3, 0.75f, Theme.TEXT_DIM, false);
            float sx = cx + 30;
            for (int i = 0; i < item.palette.length; i++) {
                final int c = item.palette[i];
                boolean on = worn.color == c;
                boolean hov = Render2D.hovered(mx, my, sx - 1, cy - 1, 12, 12);
                if (on || hov) Render2D.circle(g, sx + 5, cy + 5, 6.6f, on ? Theme.accent2() : 0x80FFFFFF);
                Render2D.circle(g, sx + 5, cy + 5, 5, 0xFF000000 | c);
                hit(sx - 1, cy - 1, 12, 12, () -> { Sounds.click(); wear(cat, worn.withColor(c), true); });
                sx += 14;
            }
            // custom colour bars
            float barX = sx + 6, barW = Math.max(40, x + w - pad - barX);
            if (barW > 50) {
                float bh = 4.5f;
                hueBar = new float[]{barX, cy, barW, bh};
                shadeBar = new float[]{barX, cy + 7, barW, bh};
                float[] hsb = ColorUtil.toHsb(0xFF000000 | worn.color);
                int segs = 12;
                for (int i = 0; i < segs; i++) {
                    int c0 = ColorUtil.hsb(i / (float) segs, 0.85f, 1f, 255), c1 = ColorUtil.hsb((i + 1) / (float) segs, 0.85f, 1f, 255);
                    Render2D.quadGradient(g, barX + barW * i / segs, cy, barW / segs + 0.3f, bh, c0, c1, c1, c0);
                }
                int pure = ColorUtil.hsb(hsb[0], Math.max(0.5f, hsb[1]), 1f, 255);
                Render2D.quadGradient(g, barX, cy + 7, barW / 2, bh, 0xFF000000, pure, pure, 0xFF000000);
                Render2D.quadGradient(g, barX + barW / 2, cy + 7, barW / 2, bh, pure, 0xFFFFFFFF, 0xFFFFFFFF, pure);
                float hk = barX + barW * hsb[0];
                float shade = shadeOf(hsb);
                float sk = barX + barW * shade;
                Render2D.circle(g, hk, cy + bh / 2, 2.8f, 0xFFFFFFFF);
                Render2D.circle(g, sk, cy + 7 + bh / 2, 2.8f, 0xFFFFFFFF);
                Render2D.circle(g, hk, cy + bh / 2, 1.6f, 0xFF000000 | ColorUtil.hsb(hsb[0], 0.85f, 1f, 255));
                Render2D.circle(g, sk, cy + 7 + bh / 2, 1.6f, 0xFF000000 | worn.color);
                hit(barX - 3, cy - 2, barW + 6, bh + 3, () -> drag = 4);
                hit(barX - 3, cy + 5.5f, barW + 6, bh + 3, () -> drag = 5);
                if (drag == 4 || drag == 5) dragColor(mx, worn);
            } else {
                hueBar = shadeBar = null;
            }
            cy += 18;
        }
        // variants and switches
        float vx = cx;
        if (item.variants.length > 0) {
            Render2D.scaledText(g, "Wariant", vx, cy + 4, 0.75f, Theme.TEXT_DIM, false);
            vx += 36;
            for (int i = 0; i < item.variants.length; i++) {
                final String v = item.variants[i];
                String label = item.variantNames[i];
                float cw = Render2D.textWidth(label) * 0.8f + 10;
                boolean on = v.equals(worn.variant);
                boolean hov = Render2D.hovered(mx, my, vx, cy, cw, 13);
                float an = anim("v" + item.id + i).target(on ? 1 : hov ? 0.5f : 0).update();
                Widgets.glowBox(g, vx, cy, cw, 13, 5, Theme.accent(), an, 0.3f + 0.7f * an);
                Render2D.scaledText(g, label, vx + 5, cy + 3.5f, 0.8f, ColorUtil.lerp(Theme.TEXT_DIM, 0xFFFFFFFF, an), false);
                hit(vx, cy, cw, 13, () -> { Sounds.click(); wear(cat, worn.withVariant(v), true); });
                vx += cw + 4;
            }
            vx += 6;
        }
        if (vx + togglesWidth(item) > x + w - pad) {
            // not enough room next to the variants: switches get their own row
            if (item.variants.length > 0) cy += 17;
            vx = cx;
        }
        if (item.animOption) vx += toggle(g, mx, my, vx, cy, "Animacja", worn.anim, () -> wear(cat, worn.withAnim(!worn.anim), true)) + 8;
        if (item.glowOption) toggle(g, mx, my, vx, cy, "Poświata", worn.glow, () -> wear(cat, worn.withGlow(!worn.glow), true));
        cy += 19;
        // sliders
        float sw = (w - pad * 2 - 12) / 2f;
        if (item.speedOption) {
            speedBar = slider(g, mx, my, cx, cy, sw, "Prędkość", (worn.speed - Worn.MIN_SPEED) / (Worn.MAX_SPEED - Worn.MIN_SPEED), String.format(java.util.Locale.ROOT, "%.2fx", worn.speed), 2, worn.anim);
        } else speedBar = null;
        if (item.scaleOption) {
            scaleBar = slider(g, mx, my, cx + sw + 12, cy, sw, "Rozmiar", (worn.scale - Worn.MIN_SCALE) / (Worn.MAX_SCALE - Worn.MIN_SCALE), Math.round(worn.scale * 100) + "%", 3, true);
        } else scaleBar = null;
        if (drag == 2 && speedBar != null) {
            float v = Math.max(0, Math.min(1, (mx - speedBar[0]) / speedBar[2]));
            float sp = Math.round((Worn.MIN_SPEED + v * (Worn.MAX_SPEED - Worn.MIN_SPEED)) * 20) / 20f;
            if (sp != worn.speed) wear(cat, worn.withSpeed(sp), false);
        }
        if (drag == 3 && scaleBar != null) {
            float v = Math.max(0, Math.min(1, (mx - scaleBar[0]) / scaleBar[2]));
            float s = Math.round((Worn.MIN_SCALE + v * (Worn.MAX_SCALE - Worn.MIN_SCALE)) * 20) / 20f;
            if (s != worn.scale) wear(cat, worn.withScale(s), false);
        }
    }

    private static float togglesWidth(Item item) {
        float w = 0;
        if (item.animOption) w += Render2D.textWidth("Animacja") * 0.75f + 32;
        if (item.glowOption) w += Render2D.textWidth("Poświata") * 0.75f + 32;
        return w;
    }

    private static float variantsWidth(Item item) {
        if (item.variants.length == 0) return 0;
        float w = 42;
        for (String n : item.variantNames) w += Render2D.textWidth(n) * 0.8f + 14;
        return w;
    }

    /** Height of the options panel: title, colour, variants (+ switches when they fit), switches, sliders. */
    private static float optionsHeight(Item item, float w) {
        if (item instanceof Items.CapeItem) return 40;
        float h = 6 + 16 + 4;
        if (item.colorOption) h += 18;
        boolean split = item.variants.length > 0 && variantsWidth(item) + togglesWidth(item) > w - 14;
        h += 19 + (split ? 17 : 0);
        if (item.speedOption || item.scaleOption) h += 16;
        return h;
    }

    /** 0 = black … 0.5 = the pure hue … 1 = white. */
    private static float shadeOf(float[] hsb) {
        if (hsb[2] < 0.999f) return hsb[2] * 0.5f;
        return 0.5f + (1 - hsb[1]) * 0.5f;
    }

    private long lastColorWrite;

    private void dragColor(int mx, Worn worn) {
        float[] hsb = ColorUtil.toHsb(0xFF000000 | worn.color);
        float h = hsb[0], shade = shadeOf(hsb), sat = Math.max(0.5f, hsb[1]);
        if (drag == 4) h = Math.max(0, Math.min(0.999f, (mx - hueBar[0]) / hueBar[2]));
        else shade = Math.max(0, Math.min(1, (mx - shadeBar[0]) / shadeBar[2]));
        int c = shade <= 0.5f ? ColorUtil.hsb(h, sat, shade * 2, 255) : ColorUtil.hsb(h, sat * (1 - (shade - 0.5f) * 2), 1, 255);
        c &= 0xFFFFFF;
        // the texture is repainted for each new colour: limit how often while dragging
        long now = System.currentTimeMillis();
        if (c != worn.color && now - lastColorWrite > 90) {
            lastColorWrite = now;
            wear(cat, worn.withColor(c), false);
        }
    }

    private float toggle(Gfx g, int mx, int my, float x, float y, String label, boolean on, final Runnable action) {
        float lw = Render2D.textWidth(label) * 0.75f;
        Render2D.scaledText(g, label, x, y + 4, 0.75f, Theme.TEXT_DIM, false);
        float p = anim("tg" + label).target(on ? 1 : 0).update();
        Widgets.toggle(g, x + lw + 4, y + 1.5f, 18, 10, p);
        hit(x, y, lw + 24, 13, () -> { Sounds.toggle(!on); action.run(); });
        return lw + 24;
    }

    private float[] slider(Gfx g, int mx, int my, float x, float y, float w, String label, float v, String value, final int id, boolean active) {
        int tc = active ? Theme.TEXT_DIM : Theme.TEXT_MUTED;
        Render2D.scaledText(g, label, x, y, 0.75f, tc, false);
        Render2D.scaledText(g, value, x + w - Render2D.textWidth(value) * 0.75f, y, 0.75f, active ? Theme.TEXT : Theme.TEXT_MUTED, false);
        float by = y + 9, bh = 3;
        Render2D.roundedRect(g, x, by, w, bh, 1.5f, 0x40FFFFFF);
        Render2D.roundedRect(g, x, by, w * v, bh, 1.5f, active ? Theme.accent() : 0x60FFFFFF);
        boolean hov = Render2D.hovered(mx, my, x - 3, by - 4, w + 6, bh + 8) || drag == id;
        float k = anim("sl" + id).target(hov ? 1 : 0).update();
        Render2D.circle(g, x + w * v, by + bh / 2, 3.2f + k, 0xFFFFFFFF);
        hit(x - 3, by - 4, w + 6, bh + 8, () -> drag = id);
        return new float[]{x, by, w, bh};
    }

    // ------------------------------------------------------------------ preview

    private void preview(Gfx g, int mx, int my, float x, float y, float w, float h) {
        panel(g, x, y, w, h, null);
        pvX = x; pvY = y; pvW = w; pvH = h - 22;
        // floor glow and a soft spotlight
        float t = Wardrobe.time();
        Render2D.radial(g, x + w / 2f, y + pvH * 0.45f, w * 0.6f, ColorUtil.withAlpha(Theme.accent(), 34), 0);
        float footY = y + pvH - 10;
        Render2D.radial(g, x + w / 2f, footY, w * 0.32f, 0x50000000, 0);
        for (int i = 0; i < 3; i++) {
            float rr = w * (0.16f + i * 0.08f) * (1 + 0.04f * (float) Math.sin(t * 1.5 + i));
            Render2D.ring(g, x + w / 2f, footY, rr, 0.8f, 0, 360, ColorUtil.withAlpha(Theme.accent(), 40 - i * 12));
        }
        // turning: drag, or slow automatic spin
        if (drag == 1) {
            dragYaw = dragStartYaw - (mx - dragStartX) * 1.4f;
            lastDrag = System.currentTimeMillis();
        }
        float yaw = yawAnim.target(dragYaw).update() + autoSpinOffset();
        Wardrobe.previewPose = pose;
        float size = Math.min(pvH / 3.1f, w / 1.8f);
        int x1 = (int) x + 2, y1 = (int) y + 2, x2 = (int) (x + w) - 2, y2 = (int) (y + pvH);
        boolean ok = false;
        try {
            ok = game().drawPlayerModel(g, x1, y1, x2, y2, size, yaw, 6);
        } catch (Throwable ignored) {
            ok = false;
        }
        if (!ok) {
            Render2D.centeredText(g, "Podgląd niedostępny", x + w / 2f, y + pvH / 2f, Theme.TEXT_MUTED, false);
        }
        if (Render2D.hovered(mx, my, x, y, w, pvH) && drag == 0) {
            Render2D.scaledText(g, "Przeciągnij, aby obrócić", x + w / 2f - Render2D.textWidth("Przeciągnij, aby obrócić") * 0.32f, y + 5, 0.64f, ColorUtil.withAlpha(Theme.TEXT_MUTED, 200), false);
        }
        hit(x, y, w, pvH, () -> {
            drag = 1;
            dragStartX = lastMx;
            dragStartYaw = dragYaw;
        });
        // pose chips + spin toggle
        float cy = y + h - 19, cw = (w - 8 - 18) / POSES.length;
        for (int i = 0; i < POSES.length; i++) {
            final int p = i;
            float bx = x + 4 + i * cw;
            boolean on = pose == i;
            boolean hov = Render2D.hovered(mx, my, bx, cy, cw - 3, 15);
            float an = anim("pose" + i).target(on ? 1 : hov ? 0.5f : 0).update();
            Widgets.glowBox(g, bx, cy, cw - 3, 15, 5, Theme.accent(), an, 0.3f + 0.7f * an);
            String l = POSES[i];
            Render2D.scaledText(g, l, bx + (cw - 3) / 2f - Render2D.textWidth(l) * 0.36f, cy + 4.5f, 0.72f, ColorUtil.lerp(Theme.TEXT_DIM, 0xFFFFFFFF, an), false);
            hit(bx, cy, cw - 3, 15, () -> { Sounds.click(); pose = p; });
        }
        float sx = x + w - 20;
        boolean sh = Render2D.hovered(mx, my, sx, cy, 15, 15);
        float sa = anim("spin").target(autoSpin ? 1 : sh ? 0.5f : 0).update();
        Widgets.glowBox(g, sx, cy, 15, 15, 5, Theme.accent(), sa, 0.3f + 0.7f * sa);
        float ang = autoSpin ? (t * 120) % 360 : 30;
        Render2D.ring(g, sx + 7.5f, cy + 7.5f, 4.2f, 1.1f, ang, ang + 270, ColorUtil.lerp(Theme.TEXT_DIM, 0xFFFFFFFF, sa));
        hit(sx, cy, 15, 15, () -> { Sounds.toggle(!autoSpin); autoSpin = !autoSpin; });
    }

    private int pose;
    private float spinPhase;
    private long spinLast = System.nanoTime();

    /** Continuous slow spin added on top of the dragged angle while auto spin is on and nobody drags. */
    private float autoSpinOffset() {
        long now = System.nanoTime();
        float dt = Math.min(0.1f, (now - spinLast) / 1e9f);
        spinLast = now;
        boolean spinning = autoSpin && drag == 0 && System.currentTimeMillis() - lastDrag > 3500;
        if (spinning) spinPhase += dt * 22;
        return spinPhase;
    }

    private int lastMx;

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        lastMx = mx;
        super.render(g, mx, my, delta);
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        lastMx = (int) mx;
        return super.mouseClicked(mx, my, button);
    }

    @Override
    public boolean mouseReleased(double mx, double my, int button) {
        if (drag >= 2) {
            // the slider / colour drags only changed the look in memory: save and publish now
            Wardrobe.setLocalLook(look(), true);
        }
        if (drag == 1) {
            // keep the spin offset in the dragged angle so releasing does not jump
            lastDrag = System.currentTimeMillis();
        }
        drag = 0;
        return true;
    }

    @Override
    public boolean mouseScrolled(double mx, double my, double amount) {
        if (Render2D.hovered(mx, my, pvX, pvY, pvW, pvH)) {
            dragYaw -= (float) amount * 25;
            lastDrag = System.currentTimeMillis();
            return true;
        }
        return super.mouseScrolled(mx, my, amount);
    }

    @Override
    public void removed() {
        if (drag >= 2) Wardrobe.setLocalLook(look(), true);
        drag = 0;
    }

    private void drawTooltip(Gfx g, String text, float x, float y) {
        float tw = Render2D.textWidth(text) * 0.75f + 10;
        float tx = Math.min(width - tw - 4, x + 8), ty = y + 12;
        if (ty + 14 > height) ty = y - 18;
        Render2D.roundedRect(g, tx, ty, tw, 13, 4, 0xF0120E0B);
        Render2D.roundedOutline(g, tx, ty, tw, 13, 4, 1, ColorUtil.withAlpha(Theme.accent(), 120));
        Render2D.scaledText(g, text, tx + 5, ty + 3.5f, 0.75f, Theme.TEXT, false);
    }
}
