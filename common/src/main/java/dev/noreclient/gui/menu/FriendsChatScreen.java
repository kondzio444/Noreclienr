package dev.noreclient.gui.menu;

/**
 * The friends chat is part of the merged "Znajomi" screen now; this entry point opens it on the
 * last conversation with the message box focused (kept for older callers).
 */
public class FriendsChatScreen extends FriendsScreen {
    public FriendsChatScreen(Object parent) {
        super(parent, LAST);
    }

    public static boolean isOpen() { return FriendsScreen.isOpen(); }
}
