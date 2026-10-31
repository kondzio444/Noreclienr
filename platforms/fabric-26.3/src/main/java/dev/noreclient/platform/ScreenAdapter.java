package dev.noreclient.platform;

import dev.noreclient.gui.NoreScreen;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.Theme;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/** Wraps a version independent NoreScreen into a real Minecraft screen. */
public class ScreenAdapter extends Screen {
    public final NoreScreen screen;

    public ScreenAdapter(NoreScreen screen) {
        super(Component.literal("Nore Client"));
        this.screen = screen;
    }

    @Override
    protected void init() {
        screen.resize(width, height);
    }

    @Override
    public void extractBackground(GuiGraphicsExtractor context, int mouseX, int mouseY, float delta) {
        if (screen.background() == NoreScreen.Background.DIM_WORLD && minecraft != null && minecraft.level != null) {
            if (Theme.blur()) super.extractBackground(context, mouseX, mouseY, delta);
            else extractTransparentBackground(context);
        }
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor context, int mouseX, int mouseY, float delta) {
        // since 1.21.6 renderWithTooltip draws the background (and the once-per-frame blur) itself
        GfxImpl g = new GfxImpl(context);
        CurrentGfx.set(g);
        screen.render(g, mouseX, mouseY, delta);
        g.finish();
    }

    // 26.3: SDL input codes are converted to the GLFW codes the client core uses
    @Override public boolean mouseClicked(net.minecraft.client.input.MouseButtonEvent click, boolean doubled) { return screen.mouseClicked(click.x(), click.y(), KeyCodes.mouseToGlfw(click.button())); }
    @Override public boolean mouseReleased(net.minecraft.client.input.MouseButtonEvent click) { return screen.mouseReleased(click.x(), click.y(), KeyCodes.mouseToGlfw(click.button())); }
    @Override public boolean mouseScrolled(double mx, double my, double h, double v) { return screen.mouseScrolled(mx, my, v); }
    @Override public boolean keyPressed(net.minecraft.client.input.KeyEvent input) { return screen.keyPressed(KeyCodes.toGlfw(input.key()), KeyCodes.modsToGlfw(input.modifiers())); }

    @Override
    public boolean charTyped(net.minecraft.client.input.CharacterEvent input) {
        if (!input.isAllowedChatCharacter()) return false;
        boolean handled = false;
        for (char c : Character.toChars(input.codepoint())) handled |= screen.charTyped(c);
        return handled;
    }
    @Override public boolean isPauseScreen() { return screen.pausesGame(); }
    @Override public boolean shouldCloseOnEsc() { return false; }
    @Override public void removed() { screen.removed(); }
    @Override public void onClose() { screen.close(); }
}
