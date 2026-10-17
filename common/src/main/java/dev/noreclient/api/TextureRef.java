package dev.noreclient.api;

/** Opaque handle to a platform texture. */
public final class TextureRef {
    public final Object handle;
    public final int width;
    public final int height;

    public TextureRef(Object handle, int width, int height) {
        this.handle = handle;
        this.width = width;
        this.height = height;
    }
}
