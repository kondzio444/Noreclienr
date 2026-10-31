package dev.noreclient.util;

import dev.noreclient.NoreClient;
import dev.noreclient.module.client.ClientSettings;

import java.util.Calendar;

/**
 * Seasonal events. They are forced on and cannot be switched off; the player only picks how strong
 * the effects are ("Efekty wydarzeń": Pełne / Średnie / Subtelne).
 * Halloween "Zgaszone światło": on now, until the end of 3 November 2026. Winter: from 10 December 2026.
 * {@code -Dnoreclient.event=halloween|winter|none} overrides the date (for testing).
 */
public final class Events {
    /** First moment after Halloween (3 November ends at midnight). */
    public static final long HALLOWEEN_END = at(2026, Calendar.NOVEMBER, 4);
    public static final long WINTER_START = at(2026, Calendar.DECEMBER, 10);

    private Events() {}

    private static long at(int y, int m, int d) {
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(y, m, d, 0, 0, 0);
        return c.getTimeInMillis();
    }

    private static String override() {
        return System.getProperty("noreclient.event");
    }

    /** Halloween is forced on from now until its end date. */
    public static boolean halloween() {
        String o = override();
        if (o != null) return o.equalsIgnoreCase("halloween");
        return System.currentTimeMillis() < HALLOWEEN_END;
    }

    public static boolean winter() {
        String o = override();
        if (o != null) return o.equalsIgnoreCase("winter");
        return System.currentTimeMillis() >= WINTER_START;
    }

    public static boolean any() { return halloween() || winter(); }

    /** Effect strength 0.45 (Subtelne), 0.7 (Średnie) or 1 (Pełne). Never 0: events cannot be disabled. */
    public static float intensity() {
        NoreClient c = NoreClient.get();
        ClientSettings s = c == null ? null : c.modules().get(ClientSettings.class);
        if (s == null) return 1;
        if (s.eventIntensity.is("Subtelne")) return 0.45f;
        if (s.eventIntensity.is("Średnie")) return 0.7f;
        return 1;
    }

    /** "6 dni" / "1 dzień" / "5 h" until the end of Halloween. */
    public static String halloweenLeft() {
        long ms = Math.max(0, HALLOWEEN_END - System.currentTimeMillis());
        long days = ms / 86_400_000L;
        if (days >= 2) return days + " dni";
        if (days == 1) return "1 dzień";
        return Math.max(1, ms / 3_600_000L) + " h";
    }

    /** Washi tape colour: kraft during events (it holds the event poster), lilac otherwise. */
    public static int tape() { return any() ? ThemeTokens.TAPE_KRAFT : ThemeTokens.TAPE_LILAC; }
}
