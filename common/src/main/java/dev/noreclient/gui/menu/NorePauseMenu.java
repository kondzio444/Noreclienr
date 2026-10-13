package dev.noreclient.gui.menu;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.click.ClickGuiScreen;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.gui.widget.SideNav;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

/** Pause menu: navigation on a glass side panel, session info on the right, the world stays visible. */
public class NorePauseMenu extends NoreScreen {
    private static final long SESSION_START = System.currentTimeMillis();

    private final long opened = System.currentTimeMillis();
    private final SideNav nav = new SideNav();
    private final Animation out = new Animation(0, 14);
    private boolean closing;

    public NorePauseMenu() {
        super(null);
    }

    @Override
    public boolean pausesGame() { return true; }

    @Override
    protected void init() {
        nav.clear();
        final NorePauseMenu self = this;
        nav.add("Powrót do gry", "Esc", SideNav.BACK, SideNav.PRIMARY, this::close)
                .add("Moduły klienta", "Prawy Shift", SideNav.GRID, SideNav.NORMAL, () -> game().openScreen(new ClickGuiScreen(self)))
                .add("Edytor HUD", "H", SideNav.HUD, SideNav.NORMAL, () -> game().openScreen(new HudEditorScreen(self)))
                .add("Postępy", null, SideNav.STAR, SideNav.NORMAL, () -> game().openAdvancements(self))
                .add("Statystyki", null, SideNav.CHART, SideNav.NORMAL, () -> game().openStats(self))
                .add("Opcje", null, SideNav.GEAR, SideNav.NORMAL, () -> game().openOptions(self));
        if (game().canOpenLan()) nav.add("Otwórz w LAN", null, SideNav.WIFI, SideNav.NORMAL, () -> game().openLan(self));
        else nav.add("Pobieraj zasoby", "Modrinth", SideNav.DOWNLOAD, SideNav.NORMAL, () -> game().openScreen(ClickGuiScreen.forDownloads(self)));
        nav.add(game().singleplayer() ? "Zapisz i wyjdź" : "Rozłącz", null, SideNav.POWER, SideNav.DANGER, () -> game().disconnect());
    }

    @Override
    public void close() { closing = true; }

    private float stage(long delay) {
        return Animation.easeOutCubic((System.currentTimeMillis() - opened - delay) / 350f);
    }

    @Override
    public void render(Gfx ctx, int mouseX, int mouseY, float delta) {
        CurrentGfx.set(ctx);
        float o = closing ? 1 - out.target(1).update() : 1;
        if (closing && o < 0.03f) {
            game().openParent(null);
            return;
        }
        ctx.setAlpha(o);
        float panelW = Math.max(170, Math.min(220, width * 0.32f));
        float slide = (1 - stage(0)) * -50 + (1 - o) * -30;
        ctx.push();
        ctx.translate(slide, 0);
        Render2D.quadGradient(ctx, 0, 0, panelW + 70, height, 0xF0080605, 0x00080605, 0x00080605, 0xF0080605);
        Render2D.quadGradient(ctx, panelW - 1, 0, 1, height, ColorUtil.withAlpha(Theme.accent(), 0), ColorUtil.withAlpha(Theme.accent(), 0), ColorUtil.withAlpha(Theme.accent(), 140), ColorUtil.withAlpha(Theme.accent(), 140));

        float pad = 16;
        Render2D.logo(ctx, pad, 18, 22, 1f);
        Render2D.gradientText(ctx, "PAUZA", pad + 28, 21, 1.6f, Theme.accent2(), Theme.accent(), true);
        Render2D.scaledText(ctx, NoreClient.NAME + " " + NoreClient.VERSION, pad + 28, 35, 0.65f, Theme.TEXT_MUTED, false);

        float rowH = Math.max(15, Math.min(22, (height - 56 - 12 - 8) / (float) nav.size()));
        float navW = panelW - pad * 2 + 12;
        float navY = Math.max(56, (height - nav.height(rowH)) / 2f + 8);
        float[] stages = new float[nav.size()];
        for (int i = 0; i < stages.length; i++) stages[i] = Math.min(o, stage(40 + i * 45L));
        nav.render(ctx, pad - 6, navY, navW, rowH, (int) (mouseX - slide), mouseY, !closing, stages);
        ctx.pop();

        // session card on the right
        float cp = stage(180) * o;
        ctx.setAlpha(cp);
        float cw = Math.min(180, width - panelW - 40);
        if (cw > 110) {
            float cx = width - cw - 14, cy = 16 + (1 - cp) * 10;
            String where = game().singleplayer() ? "Świat lokalny" : (game().serverAddress() != null ? game().serverAddress() : "Serwer");
            String[][] rows = {
                    {"Gracz", game().username()},
                    {game().singleplayer() ? "Tryb" : "Serwer", where},
                    {game().singleplayer() ? "Wymiar" : "Ping", game().singleplayer() ? dimension() : game().ping() + " ms"},
                    {"Pozycja", (int) Math.floor(game().x()) + " " + (int) Math.floor(game().y()) + " " + (int) Math.floor(game().z())},
                    {"Sesja", session()},
            };
            float ch = 24 + rows.length * 13 + 4;
            float r = Theme.radius();
            Render2D.shadow(ctx, cx, cy, cw, ch, r, 6, 0x70000000);
            Render2D.roundedRect(ctx, cx, cy, cw, ch, r, 0xD0120E0B);
            Render2D.roundedOutline(ctx, cx, cy, cw, ch, r, 1, 0x26FFFFFF);
            Render2D.quadGradient(ctx, cx + 8, cy, cw - 16, 1, 0, ColorUtil.withAlpha(Theme.accent(), 150), ColorUtil.withAlpha(Theme.accent(), 150), 0);
            Render2D.circle(ctx, cx + 11, cy + 11, 2.5f, Theme.SUCCESS);
            Render2D.text(ctx, "Sesja", cx + 18, cy + 7.5f, Theme.TEXT, false);
            for (int i = 0; i < rows.length; i++) {
                float ry = cy + 24 + i * 13;
                Render2D.scaledText(ctx, rows[i][0], cx + 10, ry, 0.72f, Theme.TEXT_MUTED, false);
                String v = Render2D.trim(rows[i][1], (int) ((cw - 70) / 0.8f));
                Render2D.scaledText(ctx, v, cx + cw - 10 - Render2D.textWidth(v) * 0.8f, ry - 0.5f, 0.8f, Theme.TEXT, false);
            }
        }
        ctx.setAlpha(1);
    }

    private String dimension() {
        String d = game().dimension();
        if ("overworld".equals(d)) return "Overworld";
        if ("the_nether".equals(d)) return "Nether";
        if ("the_end".equals(d)) return "End";
        return d;
    }

    private static String session() {
        long m = (System.currentTimeMillis() - SESSION_START) / 60000;
        return m >= 60 ? (m / 60) + " h " + (m % 60) + " min" : m + " min";
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (button != 0 || closing) return false;
        if (nav.click(mx, my)) {
            Sounds.click();
            return true;
        }
        return false;
    }

    @Override
    public boolean keyPressed(int key, int modifiers) {
        if (key == Keys.ESCAPE) {
            close();
            return true;
        }
        return false;
    }
}
