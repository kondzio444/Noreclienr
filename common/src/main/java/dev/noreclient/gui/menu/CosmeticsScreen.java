package dev.noreclient.gui.menu;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.TextureRef;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.module.social.Cosmetics;
import dev.noreclient.util.Capes;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

/** Cape picker (Nore capes, also on the elytra). */
public class CosmeticsScreen extends PanelScreen {
    public CosmeticsScreen(Object parent) {
        super(parent);
    }

    private Cosmetics module() { return NoreClient.get().modules().get(Cosmetics.class); }

    @Override protected String title() { return "KOSMETYKI"; }

    @Override protected String subtitle() { return "Peleryny Nore Client • Historia Nore i Halloween • widoczne w grze (F5) i na elytrze"; }

    @Override
    protected void content(Gfx g, int mx, int my, float x, float y, float w, float h) {
        Cosmetics c = module();
        String current = c.isEnabled() ? c.cape.get() : Capes.NAMES[0];
        int cols = Math.max(3, (int) (w / 74));
        float cw = (w - (cols - 1) * 8) / cols, ch = 96;
        viewH = h;
        int count = Capes.NAMES.length + 2;
        contentH = ((count + cols - 1) / cols) * (ch + 8);
        float sc = scrolled();
        g.scissor((int) x - 4, (int) y, (int) (x + w + 4), (int) (y + h));
        for (int i = 0; i < count; i++) {
            int col = i % cols, row = i / cols;
            float cx = x + col * (cw + 8), cy = y + row * (ch + 8) - sc;
            if (cy + ch < y || cy > y + h) continue;
            float st = intro(Math.min(i, 12) * 35L);
            cy += (1 - st) * 12;
            boolean locked = i >= Capes.NAMES.length;
            final String name = locked ? (i == Capes.NAMES.length ? "Skrzydła" : "Aureola") : Capes.NAMES[i];
            boolean sel = !locked && name.equals(current);
            boolean hov = Render2D.hovered(mx, my, cx, cy, cw, ch);
            float a = anim("c" + i).target(hov ? 1 : 0).update();
            if (sel || a > 0.01f) Render2D.shadow(g, cx, cy, cw, ch, Theme.radius(), 5, ColorUtil.withAlpha(Theme.accent(), (int) (50 + 50 * a)));
            Render2D.roundedRect(g, cx, cy, cw, ch, Theme.radius(), ColorUtil.lerp(0xB0140F0C, 0xD01C1611, a));
            Render2D.roundedOutline(g, cx, cy, cw, ch, Theme.radius(), 1, sel ? ColorUtil.withAlpha(Theme.accent(), 220) : ColorUtil.lerp(0x20FFFFFF, ColorUtil.withAlpha(Theme.accent(), 140), a));
            float pw = 30, ph = 48, px = cx + (cw - pw) / 2f, py = cy + 10 - a * 2;
            if (locked) {
                Render2D.roundedRect(g, px, py, pw, ph, 3, 0x20FFFFFF);
                Render2D.roundedOutline(g, cx + cw / 2f - 6, py + 18, 12, 10, 2, 1.2f, Theme.TEXT_MUTED);
                Render2D.ring(g, cx + cw / 2f, py + 18, 4, 1.2f, 180, 360, Theme.TEXT_MUTED);
            } else if (i == 0) {
                Render2D.roundedOutline(g, px, py, pw, ph, 3, 1, 0x40FFFFFF);
                Render2D.line(g, px + 4, py + 4, px + pw - 4, py + ph - 4, 1.2f, 0x60FF6B6B);
            } else {
                TextureRef t = Capes.preview(name, c.animated.isOn() ? (int) (System.currentTimeMillis() / 150 % Capes.FRAMES) : 0);
                Render2D.shadow(g, px, py, pw, ph, 2, 4, 0x80000000);
                if (t != null) Render2D.texture(g, t, px, py, pw, ph, 1f);
            }
            Render2D.centeredText(g, Render2D.trim(name, (int) cw - 6), cx + cw / 2f, cy + ch - 26, sel ? Theme.accent2() : Theme.TEXT, false);
            String badge = locked ? null : Capes.collection(name);
            if (badge != null) {
                // gold for "Historia Nore", night purple with pumpkin orange for the Halloween set
                boolean halloween = Capes.isHalloween(name);
                float bw = Render2D.textWidth(badge) * 0.55f + 8;
                Render2D.roundedRect(g, cx + 5, cy + 5, bw, 9, 3, halloween ? 0xE63A1458 : ColorUtil.withAlpha(0xFFFFC23D, 210));
                if (halloween) Render2D.roundedOutline(g, cx + 5, cy + 5, bw, 9, 3, 1, 0x90FF8A1F);
                Render2D.scaledText(g, badge, cx + 9, cy + 7.5f, 0.55f, halloween ? 0xFFFFB547 : 0xFF2A1A08, false);
            }
            String sub = locked ? "Sklep – wkrótce" : sel ? "Założona" : i == 0 ? "Bez peleryny" : badge != null ? Capes.tagline(name) : "Kliknij, aby założyć";
            sub = Render2D.trim(sub, (int) ((cw - 6) / 0.64f));
            Render2D.scaledText(g, sub, cx + cw / 2f - Render2D.textWidth(sub) * 0.32f, cy + ch - 14, 0.64f, sel ? Theme.SUCCESS : Theme.TEXT_MUTED, false);
            if (sel) Icons.sparkle(g, cx + cw - 9, cy + 9, 3.5f, Theme.accent2());
            if (!locked && cy >= y - 2) hit(cx, cy, cw, ch, () -> {
                if (name.equals(Capes.NAMES[0])) c.setEnabled(false);
                else { c.cape.set(name); c.setEnabled(true); }
                NoreClient.get().config().save();
            });
        }
        g.endScissor();
    }
}
