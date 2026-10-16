package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

/** Shop tab – switched off in 1.4 Beta (preview of what is coming). */
public class ShopScreen extends PanelScreen {
    private static final String[][] ITEMS = {{"Skrzydła smoka", "Animowane skrzydła"}, {"Aureola", "Świecący pierścień"}, {"Peleryny Premium", "Animowane peleryny"},
            {"Emotki", "Gesty i tańce"}, {"Zwierzątka", "Towarzysz na ramieniu"}, {"Efekty zabójstw", "Cząsteczki po kill-u"}};

    public ShopScreen(Object parent) {
        super(parent);
    }

    @Override protected String title() { return "SKLEP"; }

    @Override protected String subtitle() { return "Wkrótce • sklep jest wyłączony w Nore Client 1.4 Beta"; }

    @Override
    protected void content(Gfx g, int mx, int my, float x, float y, float w, float h) {
        float bh = 44;
        panel(g, x, y, w, bh, null);
        Render2D.gradientText(g, "Sklep Nore wystartuje wkrótce", x + 10, y + 9, 1.2f, Theme.accent2(), Theme.accent(), true);
        Render2D.scaledText(g, "Skrzydła, aureole, animowane peleryny i więcej. Darmowe peleryny znajdziesz w Kosmetykach.", x + 10, y + 27, 0.72f, Theme.TEXT_DIM, false);
        int cols = Math.max(2, (int) (w / 140));
        float cw = (w - (cols - 1) * 8) / cols, ch = 70, gy = y + bh + 10;
        for (int i = 0; i < ITEMS.length; i++) {
            float cx = x + (i % cols) * (cw + 8), cy = gy + (i / cols) * (ch + 8) + (1 - intro(i * 40L)) * 10;
            if (cy > y + h) break;
            Render2D.roundedRect(g, cx, cy, cw, ch, Theme.radius(), 0xB0160F26);
            Render2D.roundedOutline(g, cx, cy, cw, ch, Theme.radius(), 1, 0x22FFFFFF);
            Render2D.roundedGradient(g, cx + 8, cy + 8, 34, 34, 8, ColorUtil.withAlpha(Theme.accent2(), 90), ColorUtil.withAlpha(Theme.accent(), 40), true);
            Render2D.roundedOutline(g, cx + 19, cy + 23, 12, 10, 2, 1.2f, 0xFFFFFFFF);
            Render2D.ring(g, cx + 25, cy + 23, 4, 1.2f, 180, 360, 0xFFFFFFFF);
            Render2D.text(g, ITEMS[i][0], cx + 50, cy + 12, Theme.TEXT, false);
            Render2D.scaledText(g, ITEMS[i][1], cx + 50, cy + 24, 0.7f, Theme.TEXT_MUTED, false);
            Render2D.roundedRect(g, cx + 50, cy + 44, 48, 13, 6, ColorUtil.withAlpha(Theme.accent(), 50));
            Render2D.scaledText(g, "WKRÓTCE", cx + 56, cy + 47.5f, 0.66f, ColorUtil.brighten(Theme.accent(), 0.4f), false);
        }
    }
}
