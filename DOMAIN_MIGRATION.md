# Domain Migration Checklist — `chatbot.tur.al` → `chatbot.tural.ai`

Step-by-step list of every place the domain needs to change. Apply in the order at the bottom (#7) to avoid breaking webhooks for connected Instagram accounts mid-migration.

---

## 1. Meta App (Instagram)

Go to [developers.facebook.com](https://developers.facebook.com/apps) → choose the `Chatbot` app.

| Section | Field | Old | New |
|---|---|---|---|
| App Settings → Basic | **App Domains** | chatbot.tur.al | chatbot.tural.ai |
| App Settings → Basic | **Site URL** | https://chatbot.tur.al | https://chatbot.tural.ai |
| App Settings → Basic | **Privacy Policy URL** | https://chatbot.tur.al/privacy | https://chatbot.tural.ai/privacy |
| App Settings → Basic | **Terms of Service URL** | https://chatbot.tur.al/terms | https://chatbot.tural.ai/terms |
| Instagram → Business Login → Settings | **Valid OAuth Redirect URIs** | https://chatbot.tur.al/dashboard/instagram/callback | https://chatbot.tural.ai/dashboard/instagram/callback |
| Webhooks → Instagram | **Callback URL** | https://chatbot.tur.al/api/instagram/webhook | https://chatbot.tural.ai/api/instagram/webhook |
| App Review → Reviewer instructions | URL references | https://chatbot.tur.al | https://chatbot.tural.ai |
| App Review → screencast | re-record showing new domain — old one mentions the old URL | — | — |

> ⚠️ Meta may ask to verify the new domain (DNS TXT record or HTML file). Follow the prompt; it usually takes a couple of minutes.

---

## 2. Google Cloud Console (Google Sign-In)

[console.cloud.google.com](https://console.cloud.google.com/) → APIs & Services → Credentials → the OAuth 2.0 Client used by alChatBot.

- **Authorized JavaScript origins** → add `https://chatbot.tural.ai`
- Keep `https://chatbot.tur.al` during the transition, remove it after the migration is complete.

(No redirect URIs to change — we use the implicit / GIS flow.)

---

## 3. Stripe

[dashboard.stripe.com](https://dashboard.stripe.com/) → **Developers → Webhooks**.

1. Create a new webhook endpoint:
   - URL: `https://chatbot.tural.ai/api/billing/webhook`
   - Subscribe to the same events:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `invoice.payment_failed`
2. Copy the new **Signing secret** (`whsec_…`).
3. In alChatBot → **Admin → Payments**, replace `STRIPE_WEBHOOK_SECRET` with the new value, Save.
4. Leave the old webhook endpoint enabled for 1–2 days as a safety net, then delete it.

(No change needed for Customer Portal return URL — it's built dynamically from `FRONTEND_URL`.)

---

## 4. Our app (.env on the server)

`/opt/whatsappauto/.env`:

```env
FRONTEND_URL=https://chatbot.tural.ai
```

A single change cascades to:

- Instagram OAuth callback redirect
- Stripe Checkout success / cancel URLs
- Stripe Customer Portal return URL
- All email links (verification, password reset)
- Google Sign-In origin / redirect (verified server-side)

Restart the backend after editing:

```bash
sudo pm2 restart backend
```

---

## 5. DNS

Wherever **tur.al / tural.ai** DNS is managed (Cloudflare / Namecheap / registrar):

- `chatbot.tural.ai` → **A** record → `168.231.108.200`
- Keep `chatbot.tur.al` pointing to the same IP during the overlap.

Find current DNS host if unknown:

```bash
nslookup -type=NS tur.al
nslookup -type=NS tural.ai
```

---

## 6. Caddy (server)

Edit `/etc/caddy/Caddyfile` — add a new block for the new domain (don't delete the old one yet):

```caddy
chatbot.tural.ai {
    # Frontend (Next.js)
    reverse_proxy /api/* localhost:5000
    reverse_proxy localhost:3000
}
```

> Adjust the ports to match the existing `chatbot.tur.al` block.

Reload Caddy — TLS certificate is fetched automatically via Let's Encrypt:

```bash
sudo systemctl reload caddy
```

Confirm the new domain serves the app:

```bash
curl -I https://chatbot.tural.ai/api/health   # or whatever the health endpoint is
```

---

## 7. Recommended order

Doing everything at once will break Instagram webhooks for already-connected accounts mid-flight. Use this order:

1. **DNS + Caddy** → bring up the new domain with TLS (old domain still works).
2. **Meta App** → add the new domain and OAuth redirect URI **alongside** the old (don't remove the old yet). Add the new webhook callback URL.
3. **Google + Stripe** → add new entries (keep old).
4. Update **`FRONTEND_URL` in `.env`** on the server and restart the backend. From now on, new sign-ups and emails use the new domain.
5. **Re-subscribe Instagram webhooks** for every connected account so events go to the new endpoint (one-time backend script — see #8).
6. Let both domains run for 1–2 days. Watch `pm2 logs backend` for any 4xx coming from the old endpoint.
7. **Remove the old domain** from Meta App, Google, Stripe, Caddy, and DNS.

---

## 8. Bulk re-subscribe Instagram webhooks

After step 7.4 above, every existing connected Instagram account still has its webhook pointing at the old endpoint. Run this once on the server to re-subscribe them all to the new one:

```bash
cd /opt/whatsappauto && sudo tee resubscribe-ig.ts > /dev/null <<'SCRIPT'
import { prisma } from './src/lib/prisma';
import axios from 'axios';

(async () => {
  const accounts = await prisma.instagramAccount.findMany({ where: { isActive: true } });
  for (const a of accounts) {
    try {
      await axios.post(
        'https://graph.instagram.com/v25.0/me/subscribed_apps',
        'subscribed_fields=messages,comments',
        { headers: { Authorization: `Bearer ${a.accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      console.log('✓', a.igUsername);
    } catch (e: any) {
      console.log('✗', a.igUsername, '-', e.response?.data?.error?.message || e.message);
    }
  }
  process.exit(0);
})();
SCRIPT

sudo npx tsx resubscribe-ig.ts && sudo rm resubscribe-ig.ts
```

Each line shows whether re-subscribing succeeded for that account. Anything with `✗` needs the user to disconnect/reconnect manually (their token probably expired).

---

## 9. Impact on existing users

| Surface | Effect |
|---|---|
| Stripe subscriptions | Continue working — Stripe doesn't care about app domain. |
| Google Sign-In users | Continue working — Google Client ID didn't change. |
| Instagram connected accounts | Tokens stay valid; webhooks fail until #8 re-subscribe is run. |
| Email links sent BEFORE migration | Will still point to old domain — keep the old domain alive for 24h so users who click old verify/reset links still land somewhere. |

---

## 10. After migration — cleanup

Once everything is green on the new domain for a couple of days:

- Meta App: remove the old domain from App Domains and Site URL; remove the old OAuth redirect URI; remove the old webhook callback (or delete the old subscription).
- Google: remove the old JavaScript origin.
- Stripe: delete the old webhook endpoint.
- Caddy: remove the old `chatbot.tur.al { … }` block; reload.
- DNS: remove or repurpose the old subdomain.
