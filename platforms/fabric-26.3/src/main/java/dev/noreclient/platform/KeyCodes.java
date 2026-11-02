package dev.noreclient.platform;

import java.util.HashMap;
import java.util.Map;

/**
 * 26.3 switched the game window to SDL3: key codes are SDL scancodes and mouse buttons start at 1.
 * The client core (keybinds, configs, screens) keeps using GLFW codes, so they are converted at
 * the platform edge. The table pairs the InputConstants of 26.2 (GLFW) and 26.3 (SDL) by name.
 */
public final class KeyCodes {
    private KeyCodes() {}

    private static final int[] GLFW = {48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 282, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 335, 336, 264, 263, 262, 265, 334, 39, 92, 44, 61, 96, 91, 45, 332, 46, 93, 59, 47, 32, 258, 342, 341, 340, 346, 345, 344, 257, 256, 259, 261, 269, 268, 260, 267, 266, 280, 284, 281, 283};
    private static final int[] SDL = {39, 30, 31, 32, 33, 34, 35, 36, 37, 38, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 83, 98, 89, 90, 91, 92, 93, 94, 95, 96, 97, 220, 88, 103, 81, 80, 79, 82, 87, 52, 49, 54, 46, 53, 47, 45, 85, 55, 48, 51, 56, 44, 43, 226, 224, 225, 230, 228, 229, 40, 41, 42, 76, 77, 74, 73, 78, 75, 57, 72, 71, 70};
    private static final int[] GLFW_MOUSE = {0, 1, 2, 3, 4, 5, 6, 7};
    private static final int[] SDL_MOUSE = {1, 3, 2, 4, 5, 6, 7, 8};
    private static final Map<Integer, Integer> TO_GLFW = new HashMap<>(), TO_SDL = new HashMap<>(), MOUSE_TO_GLFW = new HashMap<>();

    static {
        for (int i = 0; i < GLFW.length; i++) { TO_GLFW.put(SDL[i], GLFW[i]); TO_SDL.put(GLFW[i], SDL[i]); }
        for (int i = 0; i < GLFW_MOUSE.length; i++) MOUSE_TO_GLFW.put(SDL_MOUSE[i], GLFW_MOUSE[i]);
    }

    /** SDL scancode -> GLFW key (-1 when unknown). */
    public static int toGlfw(int sdl) { return TO_GLFW.getOrDefault(sdl, -1); }

    /** GLFW key -> SDL scancode (0 = unknown). */
    public static int toSdl(int glfw) { return TO_SDL.getOrDefault(glfw, 0); }

    /** SDL mouse button (1 = left) -> GLFW button (0 = left). */
    public static int mouseToGlfw(int sdl) { return MOUSE_TO_GLFW.getOrDefault(sdl, sdl - 1); }

    /** SDL modifier mask -> GLFW modifier bits (shift 1, control 2, alt 4, super 8, caps 16, num 32). */
    public static int modsToGlfw(int sdl) {
        int m = 0;
        if ((sdl & 3) != 0) m |= 1;
        if ((sdl & 192) != 0) m |= 2;
        if ((sdl & 768) != 0) m |= 4;
        if ((sdl & 3072) != 0) m |= 8;
        if ((sdl & 8192) != 0) m |= 16;
        if ((sdl & 4096) != 0) m |= 32;
        return m;
    }
}
