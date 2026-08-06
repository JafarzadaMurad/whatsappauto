"use client";

// Mounted once in the root layout so a referral link works wherever it
// points. Linking to the homepage is the natural thing to share, and
// until this existed that click was lost the moment the visitor
// navigated anywhere else.
//
// Renders nothing.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { captureReferral } from "@/lib/referral";

export default function ReferralCapture() {
    const pathname = usePathname();
    useEffect(() => {
        // The dashboard is behind a login — a ?ref= there belongs to
        // somebody who already has an account, so there is nothing to
        // attribute and no visit worth counting.
        if (pathname?.startsWith("/dashboard")) return;
        captureReferral();
    }, [pathname]);
    return null;
}
