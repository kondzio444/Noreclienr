package dev.noreclient.gui;

import dev.noreclient.api.Game;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Platform;

/**
 * Version independent screen. Platforms wrap it in a real Minecraft screen and forward input.
 * Key codes are GLFW values (see {@link dev.noreclient.api.Keys}).
 */
public abstract class NoreScreen {
    /** How the platform should paint behind this screen before {@link #render} is called. */
    public enum Background { NONE, DIM_WORLD }

    protected int width, height;
    /** Previous screen: a NoreScreen, a platform screen object or null. */
    protected final Object parent;

    protected NoreScreen(Object parent) {
        this.parent = parent;
    }

    protected static Game game() { return Platform.game(); }

    public void resize(int width, int height) {
        this.width = width;
        this.height = height;
        init();
    }

    protected void init() {}

    public abstract void render(Gfx g, int mouseX, int mouseY, float delta);

    public Background background() { return Background.DIM_WORLD; }

    public boolean mouseClicked(double mx, double my, int button) { return false; }

    public boolean mouseReleased(double mx, double my, int button) { return false; }

    public boolean mouseScrolled(double mx, double my, double amount) { return false; }

    public boolean keyPressed(int key, int modifiers) {
        if (key == dev.noreclient.api.Keys.ESCAPE) {
            close();
            return true;
        }
        return false;
    }

    public boolean charTyped(char c) { return false; }

    public boolean pausesGame() { return false; }

    /** Called when the player presses escape / leaves; default goes back to the parent. */
    public void close() {
        game().openParent(parent);
    }

    /** Called by the platform when the screen is removed. */
    public void removed() {}

    public Object getParent() { return parent; }
}
