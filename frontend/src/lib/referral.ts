// Referral link attribution.
//
// The code arrives in a URL and the sign-up may happen days later, on a
// different page, after the person went away to think about it. Holding
// it only in the registration form's query string loses every one of
// those — which is most of them.
//
// So: the first `?ref=` seen is written to a cookie and kept. First
// touch wins; a later link does not steal an existing attribution,
// because whoever got them here did the work.

import api from "@/lib/api";

const CODE_COOKIE = "alchatbot_ref";
const VISITOR_COOKIE = "alchatbot_rv";
// Long enough to cover "I'll sign up at the weekend", short enough that
// a click somebody forgot about isn't still claiming credit next
// quarter.
const CODE_TTL_DAYS = 30;
const VISITOR_TTL_DAYS = 365;

function readCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, days: number) {
    if (typeof document === "undefined") return;
    const expires = new Date(Date.now() + days * 86400_000).toUTCString();
    // Lax, not None: the cookie only has to survive a normal top-level
    // navigation from wherever the link was shared.
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

/**
 * A stable per-browser id, so one person refreshing a link ten times
 * counts as one visitor. Random and meaningless on its own — the server
 * only ever stores a salted hash of it.
 */
function visitorId(): string {
    let id = readCookie(VISITOR_COOKIE);
    if (!id) {
        id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, "").slice(0, 32);
        writeCookie(VISITOR_COOKIE, id, VISITOR_TTL_DAYS);
    }
    return id;
}

/** The code we're currently attributing to, if any. */
export function storedReferralCode(): string | null {
    return readCookie(CODE_COOKIE);
}

/**
 * Call on any public page. Reads `?ref=`, records the visit, and
 * remembers the code for the eventual sign-up. Returns whatever code is
 * now in force, so a form can pre-fill from a click that happened
 * earlier.
 */
export function captureReferral(): string | null {
    if (typeof window === "undefined") return null;

    const params = new URLSearchParams(window.location.search);
    const fromUrl = (params.get("ref") || params.get("r") || "").trim().toUpperCase();
    const existing = storedReferralCode();

    if (fromUrl && /^[A-Z0-9]{4,16}$/.test(fromUrl)) {
        // First touch wins — an existing attribution is never overwritten.
        if (!existing) writeCookie(CODE_COOKIE, fromUrl, CODE_TTL_DAYS);

        // Fire and forget. A visit that fails to log is a missing row in
        // a chart, not a reason to interrupt someone arriving on a page.
        api.post("/referrals/visit", {
            code: fromUrl,
            landingPath: window.location.pathname,
            visitorId: visitorId(),
        }).catch(() => { /* analytics, not a dependency */ });

        return existing || fromUrl;
    }

    return existing;
}
