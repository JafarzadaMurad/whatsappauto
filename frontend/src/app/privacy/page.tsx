export default function PrivacyPage() {
    return (
        <div className="max-w-3xl mx-auto px-6 py-16">
            <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
            <p className="text-muted-foreground mb-4">Last updated: April 2026</p>

            <div className="space-y-6 text-sm leading-relaxed">
                <section>
                    <h2 className="text-lg font-semibold mb-2">1. Information We Collect</h2>
                    <p>When you connect your Instagram or WhatsApp account to alChatBot, we collect your account identifier, username, and access tokens necessary to provide AI-powered messaging services.</p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">2. How We Use Your Information</h2>
                    <p>We use your information solely to provide automated messaging services through AI agents that you configure. We do not sell or share your data with third parties.</p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">3. Data Storage</h2>
                    <p>Your data is stored securely on our servers. Access tokens are encrypted and used only for API communication with Meta platforms.</p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">4. Data Deletion</h2>
                    <p>You can disconnect your accounts at any time from the dashboard. Upon disconnection, all associated tokens and data are permanently deleted.</p>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-2">5. Contact</h2>
                    <p>For privacy-related inquiries, contact us at murad.cafarzada212@gmail.com</p>
                </section>
            </div>
        </div>
    );
}
