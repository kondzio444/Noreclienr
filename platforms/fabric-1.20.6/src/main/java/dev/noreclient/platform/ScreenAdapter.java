package dev.noreclient.platform;

import dev.noreclient.gui.NoreScreen;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

/** Wraps a version independent NoreScreen into a real Minecraft screen. */
public class ScreenAdapter extends Screen {
    public final NoreScreen screen;

    public ScreenAdapter(NoreScreen screen) {
        super(Text.literal("Nore Client"));
        this.screen = screen;
    }

    @Override
    protected void init() {
        screen.resize(width, height);
    }

    @Override
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        if (screen.background() == NoreScreen.Background.DIM_WORLD && client != null && client.world != null) {
            if (Theme.blur()) super.renderBackground(context, mouseX, mouseY, delta);
            else renderInGameBackground(context);
        }
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBackground(context, mouseX, mouseY, delta);
        GfxImpl g = new GfxImpl(context);
        CurrentGfx.set(g);
        screen.render(g, mouseX, mouseY, delta);
        g.finish();
    }

    @Override public boolean mouseClicked(double mx, double my, int button) { return screen.mouseClicked(mx, my, button); }
    @Override public boolean mouseReleased(double mx, double my, int button) { return screen.mouseReleased(mx, my, button); }
    @Override public boolean mouseScrolled(double mx, double my, double h, double v) { return screen.mouseScrolled(mx, my, v); }
    @Override public boolean keyPressed(int key, int scan, int mods) { return screen.keyPressed(key, mods); }
    @Override public boolean charTyped(char chr, int mods) { return screen.charTyped(chr); }
    @Override public boolean shouldPause() { return screen.pausesGame(); }
    @Override public boolean shouldCloseOnEsc() { return false; }
    @Override public void removed() { screen.removed(); }
    @Override public void close() { screen.close(); }
}
