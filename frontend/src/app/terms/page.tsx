export const metadata = {
    title: "Terms of Service — alChatBot",
    description: "Terms of Service for the alChatBot AI messaging platform.",
};

export default function TermsPage() {
    return (
        <div className="max-w-3xl mx-auto px-6 py-16">
            <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
            <p className="text-muted-foreground mb-8">Last updated: July 2026</p>

            <div className="space-y-6 text-sm leading-relaxed">
                <section>
                    <p>
                        These Terms of Service (&quot;Terms&quot;) govern your access to and use of alChatBot (&quot;the Service&quot;),
                        an AI-powered messaging platform provided at <a href="https://chatbot.tural.ai" className="underline">chatbot.tural.ai</a>.
                        By creating an account or using the Service, you agree to these Terms. If you do not agree, do not use the Service.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">1. Description of Service</h2>
                    <p>
                        alChatBot lets businesses connect their WhatsApp, Instagram, and other messaging channels to configurable
                        AI agents that respond to customer messages, run automation flows, and optionally book meetings on a
                        connected Google Calendar. The Service is delivered as a hosted web application; no software is installed on your device.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">2. Accounts and Eligibility</h2>
                    <p>
                        You must be at least 18 years old and legally capable of entering into contracts to use the Service.
                        You are responsible for maintaining the confidentiality of your account credentials and for every
                        action taken under your account. Notify us immediately at
                        {" "}<a href="mailto:murad.cafarzada212@gmail.com" className="underline">murad.cafarzada212@gmail.com</a>{" "}
                        if you suspect unauthorized access.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">3. Acceptable Use</h2>
                    <p>You agree not to use the Service to:</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1">
                        <li>send unsolicited bulk messages (spam) or violate the terms of any messaging platform (WhatsApp, Instagram, Meta);</li>
                        <li>impersonate any person or entity;</li>
                        <li>transmit malicious code, phishing links, or content that infringes intellectual property, privacy, or publicity rights;</li>
                        <li>facilitate fraud, harassment, hate speech, or any activity illegal in your jurisdiction;</li>
                        <li>attempt to reverse-engineer, scrape, or overload the Service.</li>
                    </ul>
                    <p className="mt-2">
                        We may suspend or terminate access without notice if we believe you have breached these rules.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">4. Third-Party Services and Data</h2>
                    <p>
                        alChatBot integrates with third-party platforms, including Meta (WhatsApp, Instagram, Facebook Ads),
                        Google (Sign-In, Calendar), and various AI model providers (OpenAI, Anthropic, Google Gemini, Z.ai).
                        When you connect one of these services, you authorize alChatBot to exchange data with them on your
                        behalf, subject to their respective terms and privacy policies. You remain responsible for compliance
                        with each provider&apos;s policies.
                    </p>
                    <p className="mt-2">
                        Google Calendar data (event listings, calendar entries you create through the Service) is used only
                        to fulfill the agent actions you configure. It is not sold, shared with third parties, or used to
                        train AI models. See our{" "}
                        <a href="/privacy" className="underline">Privacy Policy</a> for details.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">5. Your Content</h2>
                    <p>
                        You retain ownership of the content you upload or generate through the Service (messages, prompts,
                        media, contact lists, automation flows). You grant us a limited, worldwide licence to process, store,
                        and transmit this content solely to operate the Service on your behalf.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">6. Fees and Subscription</h2>
                    <p>
                        Access to certain features may require a paid subscription. Prices, billing cycles, and included
                        usage limits are described in your workspace&apos;s billing section. Fees are non-refundable except
                        where required by applicable law. We may change pricing on 30 days&apos; notice; continued use after
                        the notice period constitutes acceptance of the new pricing.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">7. Service Availability</h2>
                    <p>
                        We strive to keep the Service available and reliable but do not guarantee uninterrupted access.
                        Scheduled maintenance, third-party outages (Meta, Google, AI providers), and force-majeure events
                        may affect availability. We are not liable for losses caused by such interruptions.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">8. Termination</h2>
                    <p>
                        You may terminate your account at any time from the dashboard or by contacting support. We may
                        terminate or suspend your account for breach of these Terms, non-payment, or if we discontinue the
                        Service. Upon termination, we will delete your data in accordance with our Privacy Policy, unless
                        retention is required by law.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">9. Disclaimer of Warranties</h2>
                    <p>
                        The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind,
                        express or implied, including merchantability, fitness for a particular purpose, or non-infringement.
                        AI-generated responses may be inaccurate or inappropriate; you are responsible for reviewing and
                        approving them before relying on them for business decisions.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">10. Limitation of Liability</h2>
                    <p>
                        To the maximum extent permitted by law, alChatBot and its operators are not liable for indirect,
                        incidental, special, or consequential damages, including lost profits, lost data, or business
                        interruption arising from your use of the Service. Our total aggregate liability for any claim
                        arising out of or related to the Service is limited to the amount you paid us in the 12 months
                        preceding the claim.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">11. Changes to These Terms</h2>
                    <p>
                        We may update these Terms from time to time. Material changes will be announced through the dashboard
                        or by email at least 14 days before they take effect. Continued use of the Service after the change
                        date constitutes acceptance of the updated Terms.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">12. Governing Law</h2>
                    <p>
                        These Terms are governed by the laws of the Republic of Azerbaijan, without regard to conflict-of-law
                        principles. Any dispute arising from these Terms or your use of the Service will be resolved in the
                        competent courts of Baku, Azerbaijan.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">13. Contact</h2>
                    <p>
                        Questions about these Terms? Email us at{" "}
                        <a href="mailto:murad.cafarzada212@gmail.com" className="underline">murad.cafarzada212@gmail.com</a>.
                    </p>
                </section>
            </div>
        </div>
    );
}
