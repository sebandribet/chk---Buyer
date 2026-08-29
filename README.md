# chk! Buyer

MVP for the NextWave Hackathon challenge **The Buyer Who Isn't Human**.

chk! Buyer is a conversational purchasing interface for small businesses. It turns a user's request into a structured mandate, exposes the agent's decisions and keeps purchases auditable for the buyer and merchant.

## Current prototype

- Conversational, versioned `MandateDraft` flow.
- Mandate list and detail views with activity, offers and purchases.
- Mock account, `chk! fund`, Polygon authorization and virtual-card flow.
- Merchant mandate-verification presentation.
- Notification inbox and configurable event preferences.
- Real WhatsApp pairing and self-messaging through Baileys.
- Responsive dark admin interface.

## Run locally

```bash
npm install
npm run dev
```

- Web application: `http://localhost:5173`
- Node.js API: `http://localhost:3001`

## Production build

```bash
npm run build
npm start
```

Baileys credentials are stored locally in `.baileys-auth/` and are excluded from Git.
