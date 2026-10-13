package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.TextureRef;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.gui.widget.TextBox;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Loaded mods (like Mod Menu): icon, version, authors, description and links. */
public class ModsScreen extends PanelScreen {
    private List<String[]> mods = new ArrayList<String[]>();
    private final TextBox search = new TextBox("Szukaj modów...", 40);
    private final Map<String, Object> icons = new HashMap<String, Object>();
    private int selected;

    public ModsScreen(Object parent) {
        super(parent);
    }

    @Override
    protected void init() {
        try { mods = game().mods(); } catch (Exception e) { mods = new ArrayList<String[]>(); }
    }

    @Override protected String title() { return "MODY"; }

    @Override protected String subtitle() { return mods.size() + " załadowanych modów • Nore Client, Fabric i dodatki"; }

    private TextureRef icon(String id) {
        Object o = icons.get(id);
        if (o instanceof TextureRef) return (TextureRef) o;
        if (o != null) return null;
        byte[] png = game().modIcon(id);
        TextureRef t = png == null ? null : game().loadTexture("modicon/" + id, png);
        icons.put(id, t == null ? Boolean.FALSE : t);
        return t;
    }

    private void drawIcon(Gfx g, String[] m, float x, float y, float s) {
        TextureRef t = icon(m[0]);
        if (t != null) Render2D.texture(g, t, x, y, s, s, 1f);
        else {
            Render2D.roundedGradient(g, x, y, s, s, s * 0.22f, ColorUtil.withAlpha(Theme.accent2(), 170), ColorUtil.withAlpha(Theme.accent(), 120), true);
            Render2D.centeredText(g, m[1].isEmpty() ? "?" : m[1].substring(0, 1).toUpperCase(), x + s / 2f, y + s / 2f - 4, 0xFFFFFFFF, true);
        }
    }

    @Override
    protected void headerButtons(Gfx g, int mx, int my, float right, float y) {
        String l = "Otwórz folder mods";
        button(g, mx, my, right - buttonWidth(l), y, l, 0, true, () -> game().openUrl(new File(game().gameDir(), "mods").toURI().toString()));
    }

    @Override
    protected void content(Gfx g, int mx, int my, float x, float y, float w, float h) {
        float lw = Math.max(170, w * 0.42f);
        box(search, g, x, y, lw, 18, TextBox.SEARCH_ICON);
        String q = search.getText().trim().toLowerCase(Locale.ROOT);
        List<Integer> vis = new ArrayList<Integer>();
        for (int i = 0; i < mods.size(); i++) {
            String[] m = mods.get(i);
            if (q.isEmpty() || m[0].contains(q) || m[1].toLowerCase(Locale.ROOT).contains(q)) vis.add(i);
        }
        float ly = y + 24, lh = h - 24, row = 28;
        viewH = lh;
        contentH = vis.size() * (row + 3);
        float sc = scrolled();
        g.scissor((int) x - 4, (int) ly, (int) (x + lw + 4), (int) (ly + lh));
        for (int k = 0; k < vis.size(); k++) {
            final int i = vis.get(k);
            String[] m = mods.get(i);
            float ry = ly + k * (row + 3) - sc;
            if (ry + row < ly || ry > ly + lh) continue;
            boolean hov = my >= ly && my <= ly + lh && Render2D.hovered(mx, my, x, ry, lw, row);
            float a = anim("m" + i).target(hov ? 1 : 0).update();
            boolean sel = i == selected;
            Render2D.roundedRect(g, x, ry, lw, row, Theme.radius(), ColorUtil.lerp(0xA0140F0C, 0xD01C1611, Math.max(a, sel ? 1 : 0)));
            Render2D.roundedOutline(g, x, ry, lw, row, Theme.radius(), 1, sel ? ColorUtil.withAlpha(Theme.accent(), 200) : ColorUtil.lerp(0x18FFFFFF, ColorUtil.withAlpha(Theme.accent(), 120), a));
            drawIcon(g, m, x + 4, ry + 4, 20);
            Render2D.text(g, Render2D.trim(m[1], (int) lw - 40), x + 29, ry + 5, Theme.TEXT, false);
            Render2D.scaledText(g, Render2D.trim(m[2] + "  •  " + m[0], (int) ((lw - 34) / 0.65f)), x + 29, ry + 16, 0.65f, Theme.TEXT_MUTED, false);
            if (my >= ly && my <= ly + lh) hit(x, ry, lw, row, () -> selected = i);
        }
        g.endScissor();

        // details
        float dx = x + lw + 10, dw = w - lw - 10;
        if (dw < 120 || selected < 0 || selected >= mods.size()) return;
        String[] m = mods.get(selected);
        panel(g, dx, y, dw, h, null);
        drawIcon(g, m, dx + 10, y + 10, 48);
        Render2D.scaledText(g, Render2D.trim(m[1], (int) ((dw - 72) / 1.3f)), dx + 66, y + 13, 1.3f, Theme.TEXT, true);
        Render2D.scaledText(g, "Wersja " + m[2], dx + 66, y + 28, 0.75f, ColorUtil.brighten(Theme.accent(), 0.3f), false);
        if (!m[4].isEmpty()) Render2D.scaledText(g, Render2D.trim("Autorzy: " + m[4], (int) ((dw - 72) / 0.7f)), dx + 66, y + 38, 0.7f, Theme.TEXT_MUTED, false);
        float ty = y + 68;
        for (String line : wrap(m[3].isEmpty() ? "Brak opisu." : m[3], (int) ((dw - 20) / 0.8f))) {
            if (ty > y + h - 40) break;
            Render2D.scaledText(g, line, dx + 10, ty, 0.8f, Theme.TEXT_DIM, false);
            ty += 9;
        }
        Render2D.scaledText(g, "ID: " + m[0], dx + 10, y + h - 34, 0.65f, Theme.TEXT_MUTED, false);
        float bx = dx + 10, by = y + h - 24, maxX = dx + dw - 8;
        String[][] links = {{"Strona", m[5]}, {"Kod", m[6]}, {"Błędy", m[7]}};
        for (int k = 0; k < links.length; k++) {
            final String url = links[k][1];
            if (url.isEmpty() || bx + buttonWidth(links[k][0]) > maxX) continue;
            bx += button(g, mx, my, bx, by, links[k][0], k == 0 ? 1 : 0, true, () -> game().openUrl(url)) + 4;
        }
        if (m[5].isEmpty() && m[6].isEmpty() && m[7].isEmpty()) Icons.sparkle(g, dx + dw - 14, y + 14, 4, Theme.accent2());
    }

    static List<String> wrap(String text, int maxWidth) {
        List<String> out = new ArrayList<String>();
        for (String para : text.split("\\n")) {
            StringBuilder line = new StringBuilder();
            for (String word : para.split("\\s+")) {
                String next = line.length() == 0 ? word : line + " " + word;
                if (Render2D.textWidth(next) > maxWidth && line.length() > 0) { out.add(line.toString()); line.setLength(0); line.append(word); }
                else { line.setLength(0); line.append(next); }
            }
            if (line.length() > 0) out.add(line.toString());
        }
        return out;
    }
}
