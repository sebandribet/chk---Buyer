import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { DemoChain, errorMessage } from "./demoChain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3001;
const demo = new DemoChain();

app.use(express.json());

function respond(action, status = 200) {
  return async (request, response) => {
    try {
      response.status(status).json(await action(request));
    } catch (error) {
      response.status(422).json({ error: errorMessage(error) });
    }
  };
}

app.get("/api/health", (_request, response) => response.json({ status: "ok", demo: "flight mandate capture" }));
app.post("/api/demo/reset", respond(() => demo.reset()));
app.get("/api/demo/state", respond(() => demo.state()));
app.post("/api/demo/kyc/login", respond((request) => demo.loginAndEnrollBuyer(request.body)));
app.post("/api/demo/agent/intent", respond((request) => demo.recordIntent(request.body), 201));
app.patch("/api/demo/mandate/draft", respond((request) => demo.reviseDraft(request.body)));
app.post("/api/demo/mandate/draft/confirm", respond(() => demo.confirmDraft()));
app.post("/api/demo/mandate", respond(() => demo.createMarketplaceMandate(), 201));
app.post("/api/demo/flight/search-and-authorize", respond(() => demo.compareAndAuthorize(), 201));
app.get("/api/demo/merchant/verify/:purchaseId", respond((request) => demo.verifyPurchase(request.params.purchaseId)));
app.post("/api/demo/merchant/capture/:purchaseId", respond((request) => demo.capturePurchase(request.params.purchaseId)));
app.post("/api/demo/mandate/price-cap", respond((request) => demo.amendPriceCap(request.body.maxUnitPrice)));
app.post("/api/demo/mandate/revoke", respond(() => demo.revokeMandate()));
app.post("/api/demo/reset-to-signed", respond(() => demo.resetToSignedMandate()));
app.post("/api/demo/trial/outside-mandate", respond(() => demo.attemptOutsideMandate()));
app.post("/api/demo/trial/impersonated-agent", respond(() => demo.attemptImpersonatedAgent()));
app.post("/api/demo/trial/expired-mandate", respond(() => demo.attemptExpiredMandate()));
app.post("/api/demo/trial/revoked-mandate", respond(() => demo.attemptAfterRevocation()));

const distPath = path.resolve(__dirname, "../dist");
app.use(express.static(distPath));
app.get("/{*splat}", (_request, response) => response.sendFile(path.join(distPath, "index.html")));

app.listen(port, () => {
  console.log(`CHK! Buyer API available at http://localhost:${port}`);
});
