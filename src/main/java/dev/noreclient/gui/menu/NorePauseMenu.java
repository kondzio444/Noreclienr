package dev.noreclient.gui.menu;

import com.mojang.blaze3d.systems.RenderSystem;
import dev.noreclient.NoreClient;
import dev.noreclient.gui.click.ClickGuiScreen;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.widget.Widgets;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.GameMenuScreen;
import net.minecraft.client.gui.screen.MessageScreen;
import net.minecraft.client.gui.screen.OpenToLanScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.StatsScreen;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gui.screen.advancement.AdvancementsScreen;
import net.minecraft.client.gui.screen.multiplayer.MultiplayerScreen;
import net.minecraft.client.gui.screen.option.OptionsScreen;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;

/** Pause menu in the client's style, replacing vanilla's {@link GameMenuScreen}. */
public class NorePauseMenu extends Screen {
    /** Set to open the vanilla pause screen once without it being replaced. */
    public static boolean bypass;

    private record Entry(String label, int style, Runnable action) {}

    private static final float BW = 220, BH = 22, GAP = 6;

    private final long opened = System.currentTimeMillis();
    private final List<Entry[]> rows = new ArrayList<>();
    private final Animation[] hover = new Animation[16];
    private final Animation out = new Animation(0, 14);
    private boolean closing;

    public NorePauseMenu() {
        super(Text.literal("Pauza"));
        for (int i = 0; i < hover.length; i++) hover[i] = new Animation(0, 14);
    }

    @Override
    protected void init() {
        rows.clear();
        rows.add(new Entry[]{new Entry("Powrót do gry", Widgets.PRIMARY, this::close)});
        rows.add(new Entry[]{
                new Entry("Moduły klienta", Widgets.NORMAL, () -> client.setScreen(new ClickGuiScreen(this))),
                new Entry("Edytor HUD", Widgets.NORMAL, () -> client.setScreen(new HudEditorScreen(this)))});
        rows.add(new Entry[]{
                new Entry("Postępy", Widgets.NORMAL, () -> client.setScreen(new AdvancementsScreen(client.player.networkHandler.getAdvancementHandler(), this))),
                new Entry("Statystyki", Widgets.NORMAL, () -> client.setScreen(new StatsScreen(this, client.player.getStatHandler())))});
        boolean lan = client.isIntegratedServerRunning() && client.getServer() != null && !client.getServer().isRemote();
        rows.add(new Entry[]{
                new Entry("Ustawienia", Widgets.NORMAL, () -> client.setScreen(new OptionsScreen(this, client.options))),
                lan ? new Entry("Otwórz w LAN", Widgets.NORMAL, () -> client.setScreen(new OpenToLanScreen(this)))
                        : new Entry("Menu vanilla", Widgets.NORMAL, () -> {
                    bypass = true;
                    client.setScreen(new GameMenuScreen(true));
                })});
        rows.add(new Entry[]{new Entry(client.isInSingleplayer() ? "Zapisz i wyjdź do menu" : "Rozłącz", Widgets.DANGER, this::disconnect)});
    }

    private void disconnect() {
        boolean singleplayer = client.isInSingleplayer();
        ServerInfo server = client.getCurrentServerEntry();
        client.world.disconnect();
        if (singleplayer) client.disconnect(new MessageScreen(Text.translatable("menu.savingLevel")));
        else client.disconnect();
        TitleScreen title = new TitleScreen();
        if (singleplayer || server == null) client.setScreen(title);
        else client.setScreen(new MultiplayerScreen(title));
    }

    @Override
    public void close() {
        closing = true;
    }

    private float stage(long delay) {
        return Animation.easeOutCubic((System.currentTimeMillis() - opened - delay) / 350f);
    }

    private float panelHeight() {
        return 52 + rows.size() * (BH + GAP);
    }

    private float top() {
        return (height - panelHeight()) / 2f;
    }

    @Override
    public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
        float o = closing ? 1 - out.target(1).update() : 1;
        if (closing && o < 0.03f) {
            client.setScreen(null);
            return;
        }
        RenderSystem.setShaderColor(1, 1, 1, o);
        renderBackground(ctx, mouseX, mouseY, delta);
        Render2D.quadGradient(ctx, 0, 0, width, height,
                ColorUtil.withAlpha(Theme.accent(), 50), 0x40000000, ColorUtil.withAlpha(Theme.accent2(), 40), 0x70000000);

        float cx = width / 2f, y = top();
        float hp = stage(0);
        // header: title + player/server card
        RenderSystem.setShaderColor(1, 1, 1, o * hp);
        float ty = y - (1 - hp) * 10;
        float titleW = Render2D.textWidth("PAUZA") * 2f;
        float lx = cx - (titleW + 26) / 2f;
        Render2D.logo(ctx, lx, ty - 4, 22, hp * o);
        Render2D.gradientText(ctx, "PAUZA", lx + 26, ty, 2f, Theme.accent2(), Theme.accent(), true);
        String info = sessionInfo();
        float iw = Render2D.textWidth(info) + 20;
        Render2D.roundedRect(ctx, cx - iw / 2, ty + 22, iw, 16, 8, 0xA0101018);
        Render2D.roundedOutline(ctx, cx - iw / 2, ty + 22, iw, 16, 8, 1, 0x25FFFFFF);
        Render2D.circle(ctx, cx - iw / 2 + 9, ty + 30, 2.5f, Theme.SUCCESS);
        Render2D.text(ctx, info, cx - iw / 2 + 15, ty + 26, Theme.TEXT_DIM, false);

        float by = y + 52;
        int idx = 0;
        for (int r = 0; r < rows.size(); r++) {
            Entry[] row = rows.get(r);
            float p = stage(60 + r * 55L);
            RenderSystem.setShaderColor(1, 1, 1, o * Math.max(0, p));
            float ry = by + r * (BH + GAP) + (1 - p) * 14;
            float w = (BW - GAP * (row.length - 1)) / row.length;
            for (int c = 0; c < row.length; c++) {
                float bx = cx - BW / 2 + c * (w + GAP);
                boolean hov = p > 0.9f && !closing && Render2D.hovered(mouseX, mouseY, bx, ry, w, BH);
                Widgets.menuButton(ctx, bx, ry, w, BH, row[c].label, null, hover[idx].target(hov ? 1 : 0).update(), row[c].style);
                idx++;
            }
        }
        RenderSystem.setShaderColor(1, 1, 1, o);
        Render2D.scaledText(ctx, NoreClient.NAME + " " + NoreClient.VERSION, 6, height - 10, 0.75f, Theme.TEXT_MUTED, false);
        RenderSystem.setShaderColor(1, 1, 1, 1);
    }

    private String sessionInfo() {
        String name = client.getSession().getUsername();
        if (client.isInSingleplayer()) return name + "  •  Świat lokalny";
        ServerInfo s = client.getCurrentServerEntry();
        String ping = "";
        if (client.getNetworkHandler() != null && client.player != null) {
            PlayerListEntry e = client.getNetworkHandler().getPlayerListEntry(client.player.getUuid());
            if (e != null) ping = "  •  " + e.getLatency() + "ms";
        }
        return name + "  •  " + (s != null ? s.address : "Serwer") + ping;
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (button != 0 || closing) return false;
        float cx = width / 2f, by = top() + 52;
        for (int r = 0; r < rows.size(); r++) {
            Entry[] row = rows.get(r);
            float ry = by + r * (BH + GAP);
            float w = (BW - GAP * (row.length - 1)) / row.length;
            for (int c = 0; c < row.length; c++) {
                float bx = cx - BW / 2 + c * (w + GAP);
                if (Render2D.hovered(mx, my, bx, ry, w, BH)) {
                    Sounds.click();
                    row[c].action.run();
                    return true;
                }
            }
        }
        return super.mouseClicked(mx, my, button);
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (keyCode == GLFW.GLFW_KEY_ESCAPE) {
            close();
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }
}
