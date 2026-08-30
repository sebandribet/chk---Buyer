import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import express from "express";
import { DemoChain, errorMessage } from "./demoChain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../dist");
const app = express();
const port = process.env.PORT || 3001;
const demoChain = new DemoChain();

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

function demoError(response, error) {
  response.status(422).json({ error: errorMessage(error) });
}

app.post("/api/demo/reset", async (request, response) => {
  try {
    response.json(await demoChain.reset(request.body));
  } catch (error) {
    demoError(response, error);
  }
});

app.get("/api/demo/state", async (_request, response) => {
  try {
    response.json(await demoChain.state());
  } catch (error) {
    demoError(response, error);
  }
});

app.post("/api/demo/kyc/login", async (request, response) => {
  try {
    response.json(await demoChain.loginAndEnrollBuyer(request.body));
  } catch (error) {
    demoError(response, error);
  }
});

app.post("/api/demo/mandate", async (request, response) => {
  try {
    response.status(201).json(await demoChain.createMarketplaceMandate(request.body));
  } catch (error) {
    demoError(response, error);
  }
});

app.patch("/api/demo/mandate/draft", async (request, response) => {
  try {
    response.json(await demoChain.reviseMarketplaceDraft(request.body));
  } catch (error) {
    demoError(response, error);
  }
});

app.post("/api/demo/mandate/draft/confirm", async (_request, response) => {
  try {
    response.json(await demoChain.confirmMarketplaceDraft());
  } catch (error) {
    demoError(response, error);
  }
});

app.post("/api/demo/mandate/draft/reopen", async (_request, response) => {
  try {
    response.json(await demoChain.reopenMarketplaceDraft());
  } catch (error) {
    demoError(response, error);
  }
});

app.post("/api/demo/agent/intent", async (request, response) => {
  try {
    response.status(201).json(await demoChain.recordIntent(request.body));
  } catch (error) {
    demoError(response, error);
  }
});

app.post("/api/demo/agent/compare-and-authorize", async (_request, response) => {
  try {
    response.status(201).json(await demoChain.compareAndAuthorize());
  } catch (error) {
    demoError(response, error);
  }
});

app.post("/api/demo/agent/purchase", async (request, response) => {
  try {
    response.status(201).json(await demoChain.reservePurchase(request.body));
  } catch (error) {
    demoError(response, error);
  }
});

app.get("/api/demo/merchant/verify/:purchaseId", async (request, response) => {
  try {
    response.json(await demoChain.verifyPurchase(request.params.purchaseId));
  } catch (error) {
    demoError(response, error);
  }
});

app.post("/api/demo/merchant/capture/:purchaseId", async (request, response) => {
  try {
    response.json(await demoChain.capturePurchase(request.params.purchaseId));
  } catch (error) {
    demoError(response, error);
  }
});

app.post("/api/demo/mandate/price-cap", async (request, response) => {
  try {
    response.json(await demoChain.amendPriceCap(request.body.maxUnitPrice));
  } catch (error) {
    demoError(response, error);
  }
});

app.post("/api/demo/mandate/revoke", async (_request, response) => {
  try {
    response.json(await demoChain.revokeMandate());
  } catch (error) {
    demoError(response, error);
  }
});

app.post("/api/demo/purchase/:purchaseId/release", async (request, response) => {
  try {
    response.json(await demoChain.releasePurchase(request.params.purchaseId));
  } catch (error) {
    demoError(response, error);
  }
});
app.use(express.static(distPath));
app.get("/{*splat}", (_request, response) => {
  response.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`CHKBUYER API disponible en http://localhost:${port}`);
});
