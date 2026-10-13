package dev.noreclient.api;

/** Key codes used by Nore (GLFW values). Legacy platforms translate LWJGL 2 codes to these. */
public final class Keys {
    private Keys() {}

    public static final int UNKNOWN = -1;
    public static final int SPACE = 32, APOSTROPHE = 39, COMMA = 44, MINUS = 45, PERIOD = 46, SLASH = 47;
    public static final int N0 = 48, N9 = 57;
    public static final int A = 65, B = 66, C = 67, D = 68, H = 72, V = 86, Z = 90;
    public static final int ESCAPE = 256, ENTER = 257, TAB = 258, BACKSPACE = 259, INSERT = 260, DELETE = 261;
    public static final int RIGHT = 262, LEFT = 263, DOWN = 264, UP = 265;
    public static final int F1 = 290, F12 = 301;
    public static final int KP_ENTER = 335;
    public static final int LEFT_SHIFT = 340, LEFT_CONTROL = 341, LEFT_ALT = 342, LEFT_SUPER = 343;
    public static final int RIGHT_SHIFT = 344, RIGHT_CONTROL = 345, RIGHT_ALT = 346, RIGHT_SUPER = 347;
    public static final int MOD_SHIFT = 1, MOD_CONTROL = 2, MOD_ALT = 4;
}
