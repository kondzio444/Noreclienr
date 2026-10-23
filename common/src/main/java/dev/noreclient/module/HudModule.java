package dev.noreclient.module;

import dev.noreclient.api.Gfx;
import dev.noreclient.setting.NumberSetting;

/**
 * A draggable on-screen overlay. Position is stored relative to the free space on screen so that
 * elements keep their anchor when the window is resized.
 */
public abstract class HudModule extends Module {
    public final NumberSetting scale = add(new NumberSetting("Scale", "Rozmiar elementu", 1.0, 0.5, 3.0, 0.05, "x"));

    private float relX, relY;
    protected float width = 40, height = 16;

    protected HudModule(String name, String description, float defaultRelX, float defaultRelY) {
        super(name, description, Category.HUD);
        this.relX = defaultRelX;
        this.relY = defaultRelY;
    }

    public abstract void render(Gfx g, float tickDelta, boolean editor);

    public boolean shouldRender() { return true; }

    public float getWidth() { return width; }

    public float getHeight() { return height; }

    public float getScaledWidth() { return width * scale.floatValue(); }

    public float getScaledHeight() { return height * scale.floatValue(); }

    public float getX(int screenW) { return relX * Math.max(0, screenW - getScaledWidth()); }

    public float getY(int screenH) { return relY * Math.max(0, screenH - getScaledHeight()); }

    public void setPosition(float x, float y, int screenW, int screenH) {
        float freeW = Math.max(1, screenW - getScaledWidth());
        float freeH = Math.max(1, screenH - getScaledHeight());
        relX = Math.max(0, Math.min(1, x / freeW));
        relY = Math.max(0, Math.min(1, y / freeH));
    }

    public float getRelX() { return relX; }

    public float getRelY() { return relY; }

    public void setRel(float x, float y) {
        relX = Math.max(0, Math.min(1, x));
        relY = Math.max(0, Math.min(1, y));
    }

    protected boolean rightAligned() { return relX > 0.5f; }

    @Override
    protected boolean showsToggleNotification() { return false; }
}
