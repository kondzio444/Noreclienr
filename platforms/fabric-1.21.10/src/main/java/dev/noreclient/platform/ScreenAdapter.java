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
        // since 1.21.6 renderWithTooltip draws the background (and the once-per-frame blur) itself
        GfxImpl g = new GfxImpl(context);
        CurrentGfx.set(g);
        screen.render(g, mouseX, mouseY, delta);
        g.finish();
    }

    // 1.21.9+: input arrives as Click / KeyInput / CharInput records
    @Override public boolean mouseClicked(net.minecraft.client.gui.Click click, boolean doubled) { return screen.mouseClicked(click.x(), click.y(), click.button()); }
    @Override public boolean mouseReleased(net.minecraft.client.gui.Click click) { return screen.mouseReleased(click.x(), click.y(), click.button()); }
    @Override public boolean mouseScrolled(double mx, double my, double h, double v) { return screen.mouseScrolled(mx, my, v); }
    @Override public boolean keyPressed(net.minecraft.client.input.KeyInput input) { return screen.keyPressed(input.key(), input.modifiers()); }

    @Override
    public boolean charTyped(net.minecraft.client.input.CharInput input) {
        if (!input.isValidChar()) return false;
        boolean handled = false;
        for (char c : Character.toChars(input.codepoint())) handled |= screen.charTyped(c);
        return handled;
    }
    @Override public boolean shouldPause() { return screen.pausesGame(); }
    @Override public boolean shouldCloseOnEsc() { return false; }
    @Override public void removed() { screen.removed(); }
    @Override public void close() { screen.close(); }
}
