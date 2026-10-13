package dev.noreclient.api;

/**
 * Minimal 2D drawing surface implemented by every platform. All coordinates are GUI-scaled
 * pixels. Colours are packed ARGB.
 */
public interface Gfx {
    /** Primitive types for {@link #mesh}. */
    int TRIANGLE_FAN = 0, TRIANGLE_STRIP = 1, QUADS = 2, TRIANGLES = 3;

    void push();

    void pop();

    void translate(float x, float y);

    void scale(float sx, float sy);

    /** Coloured geometry: xy holds x0,y0,x1,y1,..., colors one ARGB per vertex. */
    void mesh(int mode, float[] xy, int[] colors, int vertexCount);

    void text(String s, float x, float y, int color, boolean shadow);

    int textWidth(String s);

    int fontHeight();

    /** Clip to a rectangle given in the current (untransformed) GUI coordinates. */
    void scissor(int x1, int y1, int x2, int y2);

    void endScissor();

    /** Draws a full texture stretched to the rectangle. */
    void texture(TextureRef tex, float x, float y, float w, float h, float alpha);

    void item(ItemInfo item, int x, int y, boolean overlay);

    void effectIcon(EffectInfo effect, float x, float y, float size, float alpha);

    /** Global opacity multiplier for everything drawn afterwards (1 = normal). */
    void setAlpha(float alpha);

    float getAlpha();

    int width();

    int height();
}
