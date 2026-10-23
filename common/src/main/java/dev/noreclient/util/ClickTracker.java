package dev.noreclient.util;

import java.util.ArrayDeque;
import java.util.Deque;

/** Counts mouse clicks within the last second for the CPS and keystrokes overlays. */
public final class ClickTracker {
    private static final Deque<Long> LEFT = new ArrayDeque<>();
    private static final Deque<Long> RIGHT = new ArrayDeque<>();

    private ClickTracker() {}

    public static synchronized void click(int button) {
        long now = System.currentTimeMillis();
        if (button == 0) LEFT.addLast(now);
        else if (button == 1) RIGHT.addLast(now);
    }

    private static int count(Deque<Long> q) {
        long cutoff = System.currentTimeMillis() - 1000;
        while (!q.isEmpty() && q.peekFirst() < cutoff) q.pollFirst();
        return q.size();
    }

    public static synchronized int left() { return count(LEFT); }

    public static synchronized int right() { return count(RIGHT); }
}
