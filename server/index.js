import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import makeWASocket, {
  DisconnectReason,
  jidNormalizedUser,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { DemoChain, errorMessage } from "./demoChain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../dist");
const authDirectory = path.resolve(__dirname, "../.baileys-auth");
const app = express();
const port = process.env.PORT || 3001;
const demoChain = new DemoChain();

const whatsapp = {
  socket: null,
  status: "disconnected",
  qr: null,
  user: null,
  error: null,
  reconnectTimer: null,
  manualLogout: false,
};

app.use(express.json());

function publicWhatsappState() {
  return {
    status: whatsapp.status,
    qr: whatsapp.qr,
    user: whatsapp.user,
    error: whatsapp.error,
  };
}

async function connectWhatsapp() {
  if (["connecting", "qr", "connected"].includes(whatsapp.status)) return;

  clearTimeout(whatsapp.reconnectTimer);
  whatsapp.manualLogout = false;
  whatsapp.status = "connecting";
  whatsapp.qr = null;
  whatsapp.error = null;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDirectory);
    const socket = makeWASocket({
      auth: state,
      browser: ["CHKBUYER", "Chrome", "1.0.0"],
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      syncFullHistory: false,
    });

    whatsapp.socket = socket;
    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (whatsapp.socket !== socket) return;

      if (qr) {
        whatsapp.status = "qr";
        whatsapp.qr = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 360,
          color: { dark: "#0d0d0d", light: "#ffffff" },
        });
      }

      if (connection === "open") {
        whatsapp.status = "connected";
        whatsapp.qr = null;
        whatsapp.error = null;
        whatsapp.user = {
          id: socket.user?.id ? jidNormalizedUser(socket.user.id) : null,
          name: socket.user?.name || null,
        };
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        whatsapp.socket = null;
        whatsapp.qr = null;
        whatsapp.user = null;

        if (whatsapp.manualLogout || loggedOut) {
          whatsapp.status = "disconnected";
          return;
        }

        whatsapp.status = "reconnecting";
        whatsapp.reconnectTimer = setTimeout(() => {
          connectWhatsapp().catch(() => {});
        }, 1500);
      }
    });
  } catch (error) {
    whatsapp.socket = null;
    whatsapp.status = "error";
    whatsapp.error = error instanceof Error ? error.message : "No se pudo iniciar WhatsApp";
  }
}

async function disconnectWhatsapp() {
  whatsapp.manualLogout = true;
  clearTimeout(whatsapp.reconnectTimer);

  const socket = whatsapp.socket;
  whatsapp.socket = null;
  whatsapp.status = "disconnected";
  whatsapp.qr = null;
  whatsapp.user = null;
  whatsapp.error = null;

  if (socket) await socket.logout().catch(() => {});
  await fs.rm(authDirectory, { recursive: true, force: true });
}

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

app.post("/api/demo/kyc/login", async (_request, response) => {
  try {
    response.json(await demoChain.loginAndEnrollBuyer());
  } catch (error) {
    demoError(response, error);
  }
});

app.post("/api/demo/mandate", async (request, response) => {
  try {
    response.status(201).json(await demoChain.createMandate(request.body));
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

app.get("/api/whatsapp/status", (_request, response) => {
  response.json(publicWhatsappState());
});

app.post("/api/whatsapp/connect", async (_request, response) => {
  await connectWhatsapp();
  response.status(202).json(publicWhatsappState());
});

app.delete("/api/whatsapp/session", async (_request, response) => {
  await disconnectWhatsapp();
  response.json(publicWhatsappState());
});

app.post("/api/whatsapp/test", async (_request, response) => {
  if (whatsapp.status !== "connected" || !whatsapp.socket?.user?.id) {
    response.status(409).json({ error: "WhatsApp is not connected" });
    return;
  }

  try {
    const recipient = jidNormalizedUser(whatsapp.socket.user.id);
    await whatsapp.socket.sendMessage(recipient, {
      text: "chk! Buyer connected successfully. You'll get updates from your purchasing agent right here.",
    });
    response.json({ sent: true });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "No se pudo enviar el mensaje",
    });
  }
});

app.use(express.static(distPath));
app.get("/{*splat}", (_request, response) => {
  response.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`CHKBUYER API disponible en http://localhost:${port}`);
});
