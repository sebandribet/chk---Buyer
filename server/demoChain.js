import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import { ethers } from "ethers";
import solc from "solc";
import { askOfficeAgent, agentConfigured } from "./officeAgent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(__dirname, "..");
const USD_DECIMALS = 6;
const paymentMethodId = ethers.id("demo-tokenized-business-card");
const kycCredentialHash = ethers.id("demo-kyc-marta-verified-business-account");

const marketplaceCatalog = [
  {
    id: "ergonomic-chair",
    name: "Ergonomic office chair",
    description: "Adjustable lumbar support · breathable mesh · black",
    aliases: ["ergonomic chair", "office chair", "chair", "chairs", "silla", "sillas"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "219", delivery: "Tomorrow", stock: "18 in stock" },
      { merchant: "SupplyHub", unitPrice: "189", delivery: "3 business days", stock: "24 in stock" },
    ],
  },
  {
    id: "ultrawide-monitor",
    name: "27-inch QHD monitor",
    description: "2560 × 1440 · USB-C 65W · height-adjustable stand",
    aliases: ["qhd monitor", "monitor", "monitors", "screen", "screens", "pantalla", "pantallas"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "279", delivery: "Tomorrow", stock: "9 in stock" },
      { merchant: "SupplyHub", unitPrice: "249", delivery: "2 business days", stock: "12 in stock" },
    ],
  },
  {
    id: "mechanical-keyboard",
    name: "Wireless mechanical keyboard",
    description: "Low-profile switches · Bluetooth + USB-C · US layout",
    aliases: ["mechanical keyboard", "wireless keyboard", "keyboard", "keyboards", "teclado", "teclados"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "96", delivery: "Tomorrow", stock: "31 in stock" },
      { merchant: "SupplyHub", unitPrice: "109", delivery: "2 business days", stock: "45 in stock" },
    ],
  },
  {
    id: "usb-c-dock",
    name: "USB-C docking station",
    description: "Dual display · 100W pass-through · Ethernet",
    aliases: ["docking station", "usb-c dock", "usb c dock", "dock", "docking"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "169", delivery: "Tomorrow", stock: "16 in stock" },
      { merchant: "SupplyHub", unitPrice: "149", delivery: "2 business days", stock: "22 in stock" },
    ],
  },
  {
    id: "webcam",
    name: "4K conference webcam",
    description: "Auto framing · dual microphone · privacy shutter",
    aliases: ["webcam", "camera", "conference camera", "camara", "cámara"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "79", delivery: "Tomorrow", stock: "40 in stock" },
      { merchant: "SupplyHub", unitPrice: "88", delivery: "3 business days", stock: "35 in stock" },
    ],
  },
  {
    id: "headphones",
    name: "Noise-cancelling headphones",
    description: "Bluetooth · 30-hour battery · travel case",
    aliases: ["headphones", "headphone", "headset", "auriculares", "auricular"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "229", delivery: "Tomorrow", stock: "14 in stock" },
      { merchant: "SupplyHub", unitPrice: "209", delivery: "2 business days", stock: "19 in stock" },
    ],
  },
  {
    id: "laptop-stand",
    name: "Aluminum laptop stand",
    description: "Adjustable height · folds flat · fits 13–16 inch laptops",
    aliases: ["laptop stand", "notebook stand", "computer stand", "soporte notebook", "soporte laptop"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "49", delivery: "Tomorrow", stock: "52 in stock" },
      { merchant: "SupplyHub", unitPrice: "55", delivery: "2 business days", stock: "47 in stock" },
    ],
  },
  {
    id: "label-printer",
    name: "Thermal label printer",
    description: "4-inch labels · USB + Wi-Fi · 150 mm/s",
    aliases: ["label printer", "thermal printer", "printer", "impresora", "impresora etiquetas"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "145", delivery: "Tomorrow", stock: "11 in stock" },
      { merchant: "SupplyHub", unitPrice: "133", delivery: "3 business days", stock: "15 in stock" },
    ],
  },
  {
    id: "external-ssd",
    name: "1TB portable SSD",
    description: "USB-C · 1,050 MB/s · encrypted backup",
    aliases: ["portable ssd", "external ssd", "ssd", "external drive", "disco externo"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "119", delivery: "Tomorrow", stock: "26 in stock" },
      { merchant: "SupplyHub", unitPrice: "109", delivery: "2 business days", stock: "34 in stock" },
    ],
  },
  {
    id: "printer-paper",
    name: "A4 printer paper · 10 reams",
    description: "80 gsm · FSC-certified · 5,000 sheets",
    aliases: ["printer paper", "copy paper", "paper", "a4", "papel", "resma"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "47", delivery: "Tomorrow", stock: "80 in stock" },
      { merchant: "SupplyHub", unitPrice: "50", delivery: "2 business days", stock: "95 in stock" },
    ],
  },
  {
    id: "desk-lamp",
    name: "LED desk lamp",
    description: "Dimmable · USB charging port · adjustable arm",
    aliases: ["desk lamp", "lamp", "lampara", "lámpara"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "59", delivery: "Tomorrow", stock: "29 in stock" },
      { merchant: "SupplyHub", unitPrice: "54", delivery: "2 business days", stock: "38 in stock" },
    ],
  },
  {
    id: "standing-desk",
    name: "Electric standing desk",
    description: "140 cm desktop · dual motor · programmable height",
    aliases: ["standing desk", "sit stand desk", "electric desk", "escritorio", "standing"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "549", delivery: "4 business days", stock: "7 in stock" },
      { merchant: "SupplyHub", unitPrice: "519", delivery: "5 business days", stock: "10 in stock" },
    ],
  },
  {
    id: "coffee-machine",
    name: "Office coffee machine",
    description: "Bean-to-cup · 20 drinks · 1.8L water tank",
    aliases: ["coffee machine", "coffee maker", "espresso machine", "cafetera", "cafe machine"],
    offers: [
      { merchant: "OfficeCore", unitPrice: "399", delivery: "3 business days", stock: "6 in stock" },
      { merchant: "SupplyHub", unitPrice: "425", delivery: "Tomorrow", stock: "8 in stock" },
    ],
  },
];

function parseWholeDollar(value) {
  const normalized = String(value ?? "").replace(/[$\s,]/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

const marketplaceMatchTerms = {
  "ergonomic-chair": ["comfortable desk seating", "back support", "lumbar support", "work from home chair", "seating for long work days"],
  "ultrawide-monitor": ["second display", "computer screen", "workstation display", "external monitor", "video editing screen"],
  "mechanical-keyboard": ["typing keyboard", "bluetooth keyboard", "wireless typing", "desk input device"],
  "usb-c-dock": ["laptop expansion", "connect monitors to laptop", "desk docking", "usb c hub", "ethernet for laptop"],
  webcam: ["video calls", "meeting camera", "remote meeting camera", "conference video"],
  headphones: ["headset for calls", "noise reduction", "travel audio", "focus headphones"],
  "laptop-stand": ["raise laptop", "laptop ergonomics", "notebook riser", "desk laptop support"],
  "label-printer": ["shipping labels", "barcode labels", "warehouse labels", "print stickers"],
  "external-ssd": ["portable storage", "backup drive", "fast external drive", "file backup"],
  "printer-paper": ["copying paper", "office printing paper", "a4 sheets", "paper reams"],
  "desk-lamp": ["workspace lighting", "reading light", "adjustable desk light", "office lamp"],
  "standing-desk": ["sit stand workstation", "height adjustable desk", "standing workstation", "desk ergonomics"],
  "coffee-machine": ["office coffee", "espresso for team", "bean to cup", "workplace coffee"],
};

for (const product of marketplaceCatalog) product.matchTerms = marketplaceMatchTerms[product.id] ?? [];

const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "any", "at", "be", "buy", "for", "from", "get", "i", "in", "is", "it", "me", "my", "need", "of", "on", "please", "some", "that", "the", "to", "want", "with", "y", "de", "el", "la", "los", "las", "me", "mi", "para", "por", "que", "un", "una", "unos", "unas", "quiero", "necesito", "comprar",
]);

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchTokens(value) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
}

function findCatalogProduct(prompt) {
  const normalizedPrompt = normalizeSearchText(prompt);
  const promptTokens = new Set(searchTokens(prompt));
  const matches = marketplaceCatalog.map((product) => {
    const terms = [product.name, product.description, ...product.aliases, ...product.matchTerms];
    let score = 0;
    for (const term of terms) {
      const normalizedTerm = normalizeSearchText(term);
      if (!normalizedTerm) continue;
      const termTokens = searchTokens(term);
      if (normalizedPrompt.includes(normalizedTerm)) {
        score += 24 + termTokens.length * 4;
        continue;
      }
      const overlap = termTokens.filter((token) => promptTokens.has(token)).length;
      if (overlap > 0) score += overlap * (termTokens.length > 1 ? 4 : 2);
    }
    return { product, score };
  }).sort((left, right) => right.score - left.score);
  return matches[0]?.score >= 4 ? matches[0].product : null;
}

function promptHasQuantity(normalized) {
  return /(?:buy|purchase|order|need|want|compr[aá]|necesito|quiero|ped[ií])\s+\d+/.test(normalized)
    || /\b\d+\s*(?:x\b|units?|items?|pcs?\b)/.test(normalized);
}

function promptQuantity(normalized, fallback = 1) {
  const quantityMatch = normalized.match(/(?:buy|purchase|order|need|want|compr[aá]|necesito|quiero|ped[ií])\s+(\d+)/)
    ?? normalized.match(/\b(\d+)\s*(?:x\b|units?|items?|pcs?\b)/);
  const quantity = Number(quantityMatch?.[1] ?? fallback);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new Error("Choose a quantity between 1 and 20 for the demo.");
  }
  return quantity;
}

function promptBudget(normalized) {
  const budgetMatch = normalized.match(/(?:under|up to|below|less than|no more than|budget(?:\s+of)?|for|hasta|menos de|max(?:imum)?|por)\s*\$?\s*([\d,.]+)/);
  return parseWholeDollar(budgetMatch?.[1]);
}

function safeReply(reply) {
  const clean = String(reply ?? "").replace(/\s+/g, " ").trim();
  return clean.length > 0 ? clean.slice(0, 360) : "";
}

function isDraftRevisionPrompt(prompt) {
  return /\b(it|that|those|same|again|instead|change|make|quantity|qty|budget|under|up to|less|more|fewer|cap|keep|adjust|revise|update|eso|esa|esos|mismo|misma|cambia|cambiar|cantidad|presupuesto|menos|mas|m[aá]s|ajusta|revisa|actualiza)\b/.test(normalizeSearchText(prompt));
}

function draftRevisionNumber(previousDraft) {
  return previousDraft ? Number(previousDraft.revision ?? 0) + 1 : 1;
}

function makeMandateDraft({
  prompt,
  productId,
  quantity,
  quantitySpecified = true,
  statedBudget,
  commitment = "committed",
  excludes = [],
  assistantReply,
  agentMode,
  agentModel,
  agentRequestId = null,
  agentError = null,
  previousDraft = null,
}) {
  const now = new Date().toISOString();
  const revision = draftRevisionNumber(previousDraft);
  const product = marketplaceCatalog.find((entry) => entry.id === productId) ?? null;
  if (!product) {
    return {
      id: previousDraft?.id ?? `draft-${Date.now()}`,
      status: "needs_revision",
      revision,
      prompt: String(prompt).trim(),
      productId: null,
      product: null,
      quantity: null,
      maxUnitPrice: null,
      budget: null,
      agentMode,
      agentModel,
      agentRequestId,
      agentError,
      createdAt: previousDraft?.createdAt ?? now,
      updatedAt: now,
      history: [...(previousDraft?.history ?? []), {
        revision,
        at: now,
        summary: "No catalog product was a safe semantic match.",
      }],
      excludes,
      // Cuando lo que frenó el borrador fue una exclusión del propio comprador,
      // decirlo importa: "no encontré nada" y "descartaste lo único que había"
      // llevan al humano a hacer cosas distintas.
      recommendation: excludes.length > 0
        ? `You ruled out ${excludes.join(", ")}, and nothing else in the catalog does that job. Lift that exclusion or describe a different product.`
        : "Try describing the use case, required capability, or a product shown in the live company catalog.",
      reply: excludes.length > 0
        ? `You asked me not to buy ${excludes.join(" or ")}, and that rules out everything I could use for this. No mandate or payment was created.`
        : `${safeReply(assistantReply) || "Sorry, I couldn't find a product in the available market that safely matches that request."} No mandate or payment was created.`,
    };
  }

  const continuingSameProduct = ["ready", "reviewed"].includes(previousDraft?.status) && previousDraft.productId === product.id;
  const fallbackQuantity = continuingSameProduct ? Number(previousDraft.quantity) : 1;
  const normalizedQuantity = Number(quantitySpecified ? quantity : fallbackQuantity);
  if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1 || normalizedQuantity > 20) {
    throw new Error("Choose a quantity between 1 and 20 for the demo.");
  }

  const highestQuote = Math.max(...product.offers.map((offer) => Number(offer.unitPrice)));
  const parsedBudget = Number(statedBudget);
  const hasStatedBudget = Number.isFinite(parsedBudget) && parsedBudget > 0;
  const totalBudget = hasStatedBudget
    ? parsedBudget
    : continuingSameProduct
      ? Number(previousDraft.maxUnitPrice) * normalizedQuantity
      : highestQuote * normalizedQuantity;
  const maxUnitPrice = totalBudget / normalizedQuantity;

  return {
    id: previousDraft?.id ?? `draft-${Date.now()}`,
    status: "ready",
    revision,
    prompt: String(prompt).trim(),
    productId: product.id,
    product: product.name,
    description: product.description,
    quantity: normalizedQuantity,
    budget: totalBudget.toFixed(2),
    maxUnitPrice: maxUnitPrice.toFixed(2),
    commitment,
    // De dónde salió el techo. Importa que se lea distinto: "buyer prompt" es
    // un límite que el humano puso; los otros dos son una sugerencia del
    // agente que todavía nadie autorizó, y la UI los muestra como tal.
    budgetSource: hasStatedBudget
      ? "buyer prompt"
      : continuingSameProduct
        ? "previous draft unit cap"
        : "agent suggestion · live seller quotes",
    approvedSellers: ["OfficeCore", "SupplyHub"],
    agentMode,
    agentModel,
    agentRequestId,
    agentError,
    createdAt: previousDraft?.createdAt ?? now,
    updatedAt: now,
    history: [...(previousDraft?.history ?? []), {
      revision,
      at: now,
      summary: continuingSameProduct
        ? `Draft revised for ${normalizedQuantity} × ${product.name}.`
        : `Draft created for ${normalizedQuantity} × ${product.name}.`,
    }],
    recommendation: "Review the editable limits, then explicitly sign this draft before any market search can run.",
    reply: safeReply(assistantReply) || (hasStatedBudget
      ? `I prepared a mandate draft for ${normalizedQuantity} × ${product.name} with a US$${totalBudget.toFixed(2)} total cap.`
      : `I prepared a mandate draft for ${normalizedQuantity} × ${product.name} using the current market's highest listed price as its cap.`),
  };
}

function parsePurchaseIntent(prompt, previousDraft = null) {
  const normalized = String(prompt ?? "").trim().toLowerCase();
  if (normalized.length < 3) throw new Error("Tell the agent what you want to buy, for example: ‘Buy 2 ergonomic chairs under $500’." );
  const matchedProduct = findCatalogProduct(normalized);
  const revisionProduct = !matchedProduct && ["ready", "reviewed"].includes(previousDraft?.status) && isDraftRevisionPrompt(normalized)
    ? marketplaceCatalog.find((product) => product.id === previousDraft.productId)
    : null;
  const product = matchedProduct ?? revisionProduct;
  const quantitySpecified = promptHasQuantity(normalized);
  return makeMandateDraft({
    prompt,
    productId: product?.id ?? "not_found",
    quantity: promptQuantity(normalized, previousDraft?.quantity ?? 1),
    quantitySpecified,
    statedBudget: promptBudget(normalized),
    agentMode: "catalog fallback",
    agentModel: null,
    agentRequestId: null,
    previousDraft,
  });
}

/**
 * Necesidad extraída → producto del catálogo. Determinístico, sin modelo.
 *
 * El agente devuelve "office chair" con { type: "ergonomic" }; acá se arma el
 * texto de búsqueda y se puntúa contra el catálogo con el mismo scorer que usa
 * el modo offline. Es el punto donde se decide qué se compra, y por eso está
 * de este lado: el modelo describe, el código resuelve.
 */
function resolveNeedToProduct(need) {
  const attrText = Object.values(need.attrs ?? {}).join(" ");
  return findCatalogProduct(`${attrText} ${need.canonical}`.trim());
}

/**
 * El borrador que produce el agente cuando le falta un dato para poder gastar.
 *
 * No es un error: es la respuesta correcta. Antes, un pedido sin presupuesto
 * generaba igual un borrador con un techo calculado por el servidor, y eso es
 * autoridad de gasto que nadie otorgó.
 */
function clarificationDraft({ prompt, agent, previousDraft }) {
  const now = new Date().toISOString();
  const questions = agent.result.questions ?? [];
  return {
    id: previousDraft?.id ?? `draft-${Date.now()}`,
    status: "needs_input",
    revision: draftRevisionNumber(previousDraft),
    prompt: String(prompt).trim(),
    productId: null,
    product: null,
    quantity: null,
    maxUnitPrice: null,
    budget: null,
    commitment: agent.result.commitment,
    questions,
    agentMode: agent.mode,
    agentModel: agent.model,
    agentRequestId: agent.requestId,
    agentError: null,
    createdAt: previousDraft?.createdAt ?? now,
    updatedAt: now,
    history: previousDraft?.history ?? [],
    recommendation: "The agent needs this before it can draft spend limits. Nothing was created and no money can move.",
    reply: agent.result.reply,
  };
}

async function resolvePurchaseIntent({ prompt, conversation, previousDraft = null }) {
  const agent = await askOfficeAgent({
    prompt,
    conversation,
    resolveNeed: resolveNeedToProduct,
    catalog: marketplaceCatalog,
  });
  if (agent.mode === "catalog fallback") return parsePurchaseIntent(prompt, previousDraft);
  if (agent.result !== null && agent.result.status === "clarification_needed") {
    return clarificationDraft({ prompt, agent, previousDraft });
  }
  if (agent.result === null) {
    const reason = safeReply(agent.error).slice(0, 240) || "The purchasing agent could not complete the request.";
    return {
      id: previousDraft?.id ?? `draft-${Date.now()}`,
      status: "agent_error",
      revision: draftRevisionNumber(previousDraft),
      prompt: String(prompt).trim(),
      productId: null,
      product: null,
      quantity: null,
      maxUnitPrice: null,
      budget: null,
      agentMode: agent.mode,
      agentModel: agent.model,
      agentRequestId: agent.requestId,
      agentError: reason,
      createdAt: previousDraft?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: previousDraft?.history ?? [],
      recommendation: "Check the agent's model connection and try again; the system did not create a mandate or payment authorization.",
      reply: `I couldn't run the purchasing agent: ${reason} No mandate was created and no money can move.`,
    };
  }
  return makeMandateDraft({
    prompt,
    productId: agent.result.productId,
    quantity: agent.result.quantity ?? 1,
    quantitySpecified: agent.result.quantityStated,
    statedBudget: agent.result.budgetStated ? agent.result.budgetUsd : null,
    commitment: agent.result.commitment,
    excludes: agent.result.excludes ?? [],
    assistantReply: agent.result.reply,
    agentMode: agent.mode,
    agentModel: agent.model,
    agentRequestId: agent.requestId,
    previousDraft,
  });
}

function compileContracts() {
  const files = [
    "contracts/interfaces/IERC20.sol",
    "contracts/interfaces/IMockCardProcessor.sol",
    "contracts/MockUSD.sol",
    "contracts/MockCardProcessor.sol",
    "contracts/MandateVault.sol",
  ];
  const sources = Object.fromEntries(
    files.map((file) => [file, { content: fs.readFileSync(path.join(rootDirectory, file), "utf8") }]),
  );
  const output = JSON.parse(
    solc.compile(JSON.stringify({
      language: "Solidity",
      sources,
      settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
    })),
  );
  const errors = (output.errors || []).filter((entry) => entry.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
  return output.contracts;
}

const compiled = compileContracts();

function artifact(source, name) {
  const contract = compiled[source][name];
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

async function deploy(signer, source, name, args = []) {
  const { abi, bytecode } = artifact(source, name);
  const contract = await new ethers.ContractFactory(abi, bytecode, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

function parseUsd(value, label) {
  try {
    const amount = ethers.parseUnits(String(value), USD_DECIMALS);
    if (amount <= 0n) throw new Error();
    return amount;
  } catch {
    throw new Error(`${label} must be a positive USD amount, for example "130".`);
  }
}

function displayUsd(amount) {
  return ethers.formatUnits(amount, USD_DECIMALS);
}

function errorMessage(error) {
  return error?.info?.error?.message || error?.shortMessage || error?.message || "Transaction failed";
}

function deliveryDays(delivery) {
  if (/tomorrow/i.test(String(delivery))) return 1;
  const days = String(delivery).match(/(\d+)/);
  return days ? Number(days[1]) : 99;
}

function evaluateMarketplaceOffers(product, draft) {
  return product.offers.map((offer) => {
    const unitPrice = Number(offer.unitPrice);
    const amount = unitPrice * Number(draft.quantity);
    const rejectionReasons = [];
    if (unitPrice > Number(draft.maxUnitPrice)) {
      rejectionReasons.push(`US$${unitPrice.toFixed(2)} per unit exceeds the signed US$${draft.maxUnitPrice} cap.`);
    }
    if (amount > Number(draft.budget)) {
      rejectionReasons.push(`US$${amount.toFixed(2)} total exceeds the signed US$${draft.budget} budget.`);
    }
    return {
      ...offer,
      amount: amount.toFixed(2),
      deliveryDays: deliveryDays(offer.delivery),
      eligible: rejectionReasons.length === 0,
      rejectionReasons,
    };
  });
}

async function reportWalletBalances(runtime) {
  return {
    buyer: displayUsd(await runtime.usd.balanceOf(runtime.owner.address)),
    OfficeCore: displayUsd(await runtime.usd.balanceOf(runtime.merchant.address)),
    SupplyHub: displayUsd(await runtime.usd.balanceOf(runtime.alternateMerchant.address)),
  };
}

function balanceMovement(before, after) {
  const delta = Number(after) - Number(before);
  return {
    before,
    after,
    delta: `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`,
  };
}

function reportDraftSnapshot(draft) {
  if (!draft) return null;
  return {
    id: draft.id,
    revision: draft.revision,
    productId: draft.productId,
    product: draft.product,
    quantity: draft.quantity,
    unitPriceCap: draft.maxUnitPrice,
    totalBudget: draft.budget,
    approvedSellers: draft.approvedSellers ?? ["OfficeCore", "SupplyHub"],
    sourcePrompt: draft.prompt,
  };
}

/**
 * Local-only demo adapter. It intentionally mirrors the production boundary:
 * the chain stores authority and audit state, while the card processor is a
 * replaceable payment adapter. No real card data or money is handled here.
 */
export class DemoChain {
  constructor() {
    this.runtime = null;
    this.audit = [];
  }

  async reset(options = {}) {
    const maxUnitPrice = parseUsd(options.maxUnitPrice ?? "150", "maxUnitPrice");
    const budget = parseUsd(options.budget ?? "150", "budget");
    const quantity = BigInt(options.quantity ?? 1);
    if (quantity <= 0n || budget < quantity * maxUnitPrice) {
      throw new Error("budget must cover quantity × maxUnitPrice.");
    }

    const ganacheProvider = ganache.provider({ logging: { quiet: true } });
    const provider = new ethers.BrowserProvider(ganacheProvider);
    const wallets = Object.values(ganacheProvider.getInitialAccounts()).map(({ secretKey }) => {
      const wallet = new ethers.Wallet(secretKey, provider);
      // Ganache's in-memory provider can report a stale nonce to a plain Wallet.
      // NonceManager keeps each real signer deterministic while retaining its ability to sign quotes.
      const signer = new ethers.NonceManager(wallet);
      signer.address = wallet.address;
      return signer;
    });
    const [owner, agent, merchant, alternateMerchant] = wallets;
    const usd = await deploy(owner, "contracts/MockUSD.sol", "MockUSD");
    const processor = await deploy(owner, "contracts/MockCardProcessor.sol", "MockCardProcessor", [usd.target]);
    const vault = await deploy(owner, "contracts/MandateVault.sol", "MandateVault", [processor.target]);

    const setVaultTx = await processor.setVault(vault.target);
    await setVaultTx.wait();
    await (await usd.mint(owner.address, parseUsd("2000", "seed balance"))).wait();

    this.runtime = {
      provider,
      owner,
      agent,
      merchant,
      alternateMerchant,
      usd,
      processor,
      vault,
      productHash: ethers.id(options.product ?? "flight-cordoba"),
      mandateOptions: { quantity, maxUnitPrice, budget },
      paymentMethodId,
      kycCredentialHash,
      buyer: { name: "Marta", email: "marta@demo.local", company: "Marta Studio" },
      draft: null,
      signedMandate: null,
      marketSearch: { status: "not_started", evaluatedOffers: [], advice: [] },
      reports: [],
      lastReportId: null,
      marketplaceMandate: false,
      activeMarketplaceMandateId: null,
      selectedPurchase: null,
      conversation: [{
        role: "assistant",
        content: "Hi — tell me what you need and I’ll search both seller catalogs before preparing a purchase.",
      }],
      agentMode: agentConfigured() ? "agent ready" : "catalog fallback",
      agentModel: agentConfigured() ? (process.env.OPENAI_MODEL ?? "gpt-4.1-mini") : null,
      agentRequestId: null,
      agentError: null,
      paymentMethodEnrolled: false,
      mandateCreated: false,
      staticMandateCreated: false,
    };
    this.audit = [{
      type: "local_payment_stack_deployed",
      detail: "Local chain, mandate registry, credential provider, and mock bank account are ready.",
      transactionHash: vault.deploymentTransaction().hash,
      blockNumber: (await vault.deploymentTransaction().wait()).blockNumber,
    }];
    return this.state();
  }

  async loginAndEnrollBuyer(profile = {}) {
    const runtime = await this.ensure();
    if (runtime.paymentMethodEnrolled) throw new Error("Buyer KYC/login and payment enrollment are already complete.");

    const name = String(profile.name ?? runtime.buyer.name).trim();
    const email = String(profile.email ?? runtime.buyer.email).trim();
    const company = String(profile.company ?? runtime.buyer.company).trim();
    if (!name || !email || !company) throw new Error("Name, business email, and company are required for the mock KYC check.");
    runtime.buyer = { name, email, company };
    runtime.paymentMethodId = ethers.id(`demo-payment-method:${email.toLowerCase()}`);
    runtime.kycCredentialHash = ethers.id(`demo-kyc:${name.toLowerCase()}:${email.toLowerCase()}:${company.toLowerCase()}`);

    const enrollmentTx = await runtime.processor.connect(runtime.owner).registerVerifiedPaymentMethod(
      runtime.paymentMethodId,
      runtime.owner.address,
      runtime.kycCredentialHash,
    );
    const enrollmentReceipt = await enrollmentTx.wait();
    const consentTx = await runtime.usd.connect(runtime.owner).approve(runtime.processor.target, ethers.MaxUint256);
    const consentReceipt = await consentTx.wait();
    runtime.paymentMethodEnrolled = true;
    this.audit.push({
      type: "kyc_login_payment_enrolled",
      detail: `${runtime.buyer.name}'s verified login is linked to an opaque payment token. No card number or funds are on-chain.`,
      transactionHash: enrollmentTx.hash,
      blockNumber: enrollmentReceipt.blockNumber,
    });
    this.audit.push({
      type: "bank_capture_consent_recorded",
      detail: "The saved payment token can be charged only by an eligible one-use authorization at capture.",
      transactionHash: consentTx.hash,
      blockNumber: consentReceipt.blockNumber,
    });
    return this.state();
  }

  async createMandate(options = {}) {
    const runtime = await this.ensure();
    if (!runtime.paymentMethodEnrolled) throw new Error("Complete buyer KYC/login and payment enrollment before signing a mandate.");
    if (runtime.mandateCreated) throw new Error("This demo already has an active mandate. Reset to create another.");

    const quantity = BigInt(options.quantity ?? runtime.mandateOptions.quantity);
    const maxUnitPrice = options.maxUnitPrice === undefined
      ? runtime.mandateOptions.maxUnitPrice
      : parseUsd(options.maxUnitPrice, "maxUnitPrice");
    const budget = options.budget === undefined
      ? runtime.mandateOptions.budget
      : parseUsd(options.budget, "budget");
    if (quantity <= 0n || budget < quantity * maxUnitPrice) {
      throw new Error("budget must cover quantity × maxUnitPrice.");
    }

    const latestBlock = await runtime.provider.getBlock("latest");
    const createMandateTx = await runtime.vault.connect(runtime.owner).createMandate(
      runtime.agent.address,
      runtime.merchant.address,
      runtime.paymentMethodId,
      runtime.productHash,
      quantity,
      maxUnitPrice,
      budget,
      Number(latestBlock.timestamp) + 30 * 24 * 60 * 60,
    );
    const createMandateReceipt = await createMandateTx.wait();
    runtime.mandateCreated = true;
    runtime.staticMandateCreated = true;
    this.audit.push({
      type: "mandate_signed",
      detail: "Buyer signed a revocable purchase mandate using the KYC-linked payment token; no funds were pre-funded.",
      transactionHash: createMandateTx.hash,
      blockNumber: createMandateReceipt.blockNumber,
    });
    return this.state();
  }

  addReport(runtime, report) {
    const record = {
      id: `RPT-${String(runtime.reports.length + 1).padStart(3, "0")}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...report,
    };
    runtime.reports.push(record);
    runtime.lastReportId = record.id;
    return record;
  }

  async recordIntent({ prompt }) {
    const runtime = await this.ensure();
    if (runtime.activeMarketplaceMandateId !== null) {
      if (runtime.selectedPurchase === null) {
        throw new Error(runtime.marketSearch.status === "no_eligible_option"
          ? "No seller met the signed mandate. Choose ‘Revise signed mandate’ before changing it."
          : "A signed mandate is active. Finish its market search before creating another draft.");
      }
      const currentPurchase = await runtime.vault.purchases(runtime.selectedPurchase.purchaseId);
      if (Number(currentPurchase.status) !== 2 && Number(currentPurchase.status) !== 3) {
        throw new Error("The current seller authorization must be captured or released before starting another purchase.");
      }
      runtime.activeMarketplaceMandateId = null;
      runtime.marketplaceMandate = false;
      runtime.mandateCreated = false;
      runtime.selectedPurchase = null;
      runtime.signedMandate = null;
    }

    const draft = await resolvePurchaseIntent({
      prompt,
      conversation: runtime.conversation,
      previousDraft: runtime.draft,
    });
    runtime.draft = draft;
    runtime.agentMode = draft.agentMode;
    runtime.agentModel = draft.agentModel;
    runtime.agentRequestId = draft.agentRequestId;
    runtime.agentError = draft.agentError ?? null;
    runtime.conversation.push({ role: "user", content: String(prompt).trim() });
    runtime.conversation.push({ role: "assistant", content: draft.reply });

    if (draft.status !== "ready") {
      const report = this.addReport(runtime, {
        status: "not_executed",
        title: "Draft needs revision",
        summary: draft.reply,
        recommendation: draft.recommendation,
        draft: reportDraftSnapshot(draft),
        agent: { mode: draft.agentMode, model: draft.agentModel, responseId: draft.agentRequestId },
        decision: { rationale: "No safe product match was approved for a mandate draft.", offers: [], selectedMerchant: null },
        authorization: null,
        verification: null,
        settlement: null,
        mockFundsMoved: false,
      });
      this.audit.push({
        type: draft.status === "needs_revision" ? "mandate_draft_needs_revision" : "openai_agent_unavailable",
        detail: draft.reply,
        transactionHash: null,
        blockNumber: null,
      });
      return { draft, intent: draft, report, state: await this.state() };
    }

    runtime.marketSearch = { status: "not_started", evaluatedOffers: [], advice: [] };
    this.audit.push({
      type: draft.revision === 1 ? "mandate_draft_created" : "mandate_draft_revised_by_chat",
      detail: `Draft v${draft.revision}: ${draft.quantity} × ${draft.product}, US$${draft.maxUnitPrice} per unit, US$${draft.budget} total cap.`,
      transactionHash: null,
      blockNumber: null,
    });
    return { draft, intent: draft, state: await this.state() };
  }

  async reviseMarketplaceDraft(changes = {}) {
    const runtime = await this.ensure();
    const draft = runtime.draft;
    if (!draft || !["ready", "reviewed"].includes(draft.status)) {
      throw new Error("Create an editable mandate draft before revising it.");
    }
    if (runtime.activeMarketplaceMandateId !== null) throw new Error("A signed mandate cannot be changed in place. Revise the signed mandate first.");

    const product = marketplaceCatalog.find((entry) => entry.id === (changes.productId ?? draft.productId));
    if (!product) throw new Error("Choose a product from the live company catalog.");
    const quantity = Number(changes.quantity ?? draft.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new Error("Choose a quantity between 1 and 20 for the demo.");
    }
    const maxUnitPrice = parseUsd(changes.maxUnitPrice ?? draft.maxUnitPrice, "maxUnitPrice");
    const budget = parseUsd(changes.budget ?? draft.budget, "budget");
    if (budget < BigInt(quantity) * maxUnitPrice) {
      throw new Error("The total cap must cover quantity × unit-price cap.");
    }

    const revision = draftRevisionNumber(draft);
    const now = new Date().toISOString();
    runtime.draft = {
      ...draft,
      status: "ready",
      revision,
      productId: product.id,
      product: product.name,
      description: product.description,
      quantity,
      maxUnitPrice: displayUsd(maxUnitPrice),
      budget: displayUsd(budget),
      budgetSource: "buyer edit",
      updatedAt: now,
      reviewedAt: null,
      recommendation: "Review the revised limits, confirm the final terms, then sign to the local mock chain.",
      reply: `Draft v${revision} is ready for review: ${quantity} × ${product.name}, up to US$${displayUsd(maxUnitPrice)} each and US$${displayUsd(budget)} total.`,
      history: [...(draft.history ?? []), { revision, at: now, summary: "Buyer edited the mandate terms." }],
    };
    runtime.marketSearch = { status: "not_started", evaluatedOffers: [], advice: [] };
    this.audit.push({
      type: "mandate_draft_revised_by_buyer",
      detail: `Buyer edited draft v${revision}; it is not spend authority until reviewed and signed.`,
      transactionHash: null,
      blockNumber: null,
    });
    return this.state();
  }

  async confirmMarketplaceDraft() {
    const runtime = await this.ensure();
    if (runtime.draft?.status !== "ready") throw new Error("An editable mandate draft is required before confirmation.");
    runtime.draft = {
      ...runtime.draft,
      status: "reviewed",
      reviewedAt: new Date().toISOString(),
      recommendation: "Terms confirmed. Sign this exact revision to the local mock chain to grant market-search authority.",
    };
    this.audit.push({
      type: "mandate_draft_confirmed_by_buyer",
      detail: `Buyer confirmed mandate draft v${runtime.draft.revision}; signing remains a separate explicit action.`,
      transactionHash: null,
      blockNumber: null,
    });
    return this.state();
  }

  async createMarketplaceMandate() {
    const runtime = await this.ensure();
    const draft = runtime.draft;
    if (!runtime.paymentMethodEnrolled) throw new Error("Complete buyer KYC/login before signing a mandate.");
    if (draft?.status !== "reviewed") throw new Error("Review and confirm the definitive mandate draft before signing it.");
    if (runtime.activeMarketplaceMandateId !== null) throw new Error("This demo already has an active marketplace mandate.");

    const quantity = BigInt(draft.quantity);
    const maxUnitPrice = parseUsd(draft.maxUnitPrice, "maxUnitPrice");
    const budget = parseUsd(draft.budget, "budget");
    if (budget < quantity * maxUnitPrice) {
      throw new Error("The mandate budget must cover the quantity multiplied by its unit-price cap.");
    }

    runtime.productHash = ethers.id(draft.productId);
    runtime.mandateOptions = { quantity, maxUnitPrice, budget };
    const latestBlock = await runtime.provider.getBlock("latest");
    const merchants = [runtime.merchant.address, runtime.alternateMerchant.address];
    const mandateId = await runtime.vault.nextMandateId();
    const tx = await runtime.vault.connect(runtime.owner).createMarketplaceMandate(
      runtime.agent.address,
      merchants,
      runtime.paymentMethodId,
      runtime.productHash,
      quantity,
      maxUnitPrice,
      budget,
      Number(latestBlock.timestamp) + 30 * 24 * 60 * 60,
    );
    const receipt = await tx.wait();
    const signing = {
      mandateId: mandateId.toString(),
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
      signedAt: new Date().toISOString(),
      network: "CHK local chain (Ganache)",
      terms: reportDraftSnapshot(draft),
    };
    runtime.mandateCreated = true;
    runtime.marketplaceMandate = true;
    runtime.activeMarketplaceMandateId = mandateId;
    runtime.signedMandate = signing;
    runtime.draft = { ...draft, status: "signed", signing, recommendation: "The signed mandate is now the only authority used for the market search." };
    runtime.marketSearch = { status: "not_started", evaluatedOffers: [], advice: [] };
    this.audit.push({
      type: "marketplace_mandate_signed",
      detail: `${runtime.buyer.name} signed definitive draft v${draft.revision} for ${draft.product} under mandate ${mandateId}.`,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
    return this.state();
  }

  async reopenMarketplaceDraft() {
    const runtime = await this.ensure();
    if (runtime.draft?.status !== "signed" || runtime.marketSearch.status !== "no_eligible_option" || runtime.activeMarketplaceMandateId === null) {
      throw new Error("Only a signed mandate with no eligible seller can be reopened for revision.");
    }
    const mandateId = runtime.activeMarketplaceMandateId;
    const tx = await runtime.vault.connect(runtime.owner).revokeMandate(mandateId);
    const receipt = await tx.wait();
    const previous = runtime.draft;
    const revision = draftRevisionNumber(previous);
    const now = new Date().toISOString();
    runtime.draft = {
      ...previous,
      status: "ready",
      revision,
      reviewedAt: null,
      signing: null,
      updatedAt: now,
      recommendation: "The previous signed mandate was revoked with no payment. Edit this new draft revision, confirm it, and sign again.",
      reply: `No money moved. Draft v${revision} is open for revision after the previous mandate was revoked.`,
      history: [...(previous.history ?? []), { revision, at: now, summary: "Reopened after no seller met the signed terms." }],
    };
    runtime.activeMarketplaceMandateId = null;
    runtime.marketplaceMandate = false;
    runtime.mandateCreated = false;
    runtime.signedMandate = null;
    runtime.marketSearch = { status: "not_started", evaluatedOffers: [], advice: [] };
    this.audit.push({
      type: "marketplace_mandate_revoked_for_revision",
      detail: `No seller was eligible, so mandate ${mandateId} was revoked before draft v${revision} was opened.`,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
    return this.state();
  }

  async compareAndAuthorize() {
    const runtime = await this.ensure();
    const draft = runtime.draft;
    if (!runtime.marketplaceMandate || runtime.activeMarketplaceMandateId === null || draft?.status !== "signed") {
      throw new Error("A signed definitive mandate is required before searching the market.");
    }
    if (runtime.selectedPurchase) throw new Error("The agent already selected and authorized an offer. Capture or release it before another search.");

    const product = marketplaceCatalog.find((entry) => entry.id === draft.productId);
    const quotes = evaluateMarketplaceOffers(product, draft);
    const eligibleQuotes = quotes.filter((quote) => quote.eligible)
      .sort((left, right) => Number(left.unitPrice) - Number(right.unitPrice) || left.deliveryDays - right.deliveryDays);
    const mandateSnapshot = runtime.signedMandate;
    if (eligibleQuotes.length === 0) {
      const advice = [
        `Raise the per-unit cap above US$${Math.min(...quotes.map((quote) => Number(quote.unitPrice))).toFixed(2)},`,
        "reduce the quantity, or reopen the draft to change the product requirements.",
      ];
      runtime.marketSearch = {
        status: "no_eligible_option",
        searchedAt: new Date().toISOString(),
        evaluatedOffers: quotes,
        advice,
        decision: null,
      };
      const report = this.addReport(runtime, {
        status: "not_executed",
        title: "No seller met the signed mandate",
        summary: `The agent evaluated ${quotes.length} seller offers for ${draft.product}; each failed at least one signed limit.`,
        recommendation: advice.join(" "),
        draft: reportDraftSnapshot(draft),
        mandate: mandateSnapshot,
        agent: { mode: draft.agentMode, model: draft.agentModel, responseId: draft.agentRequestId },
        decision: {
          rationale: "No seller quote passed both the signed unit-price cap and total-budget cap.",
          offers: quotes,
          selectedMerchant: null,
          savingsVsNextEligible: null,
        },
        authorization: null,
        verification: null,
        settlement: null,
        mockFundsMoved: false,
      });
      this.audit.push({
        type: "market_search_no_eligible_option",
        detail: report.summary,
        transactionHash: null,
        blockNumber: null,
      });
      return { status: "no_eligible_option", report, state: await this.state() };
    }

    const selected = eligibleQuotes[0];
    const nextEligible = eligibleQuotes[1] ?? null;
    const merchant = selected.merchant === "OfficeCore" ? runtime.merchant : runtime.alternateMerchant;
    const mandateId = runtime.activeMarketplaceMandateId;
    const orderReference = `${selected.merchant}-${product.id}-${Date.now()}`;
    const orderId = ethers.id(orderReference);
    const quotedAt = await runtime.provider.getBlock("latest");
    const checkoutExpiresAt = Number(quotedAt.timestamp) + 5 * 60;
    const unitPrice = parseUsd(selected.unitPrice, "unitPrice");
    const quantity = BigInt(draft.quantity);
    const checkoutHash = await runtime.vault.marketplaceCheckoutHashFor(
      mandateId, merchant.address, orderId, checkoutExpiresAt, quantity, unitPrice,
    );
    const signature = await merchant.signMessage(ethers.getBytes(checkoutHash));
    const purchaseId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [mandateId, checkoutHash]),
    );
    const balancesBefore = await reportWalletBalances(runtime);
    const tx = await runtime.vault.connect(runtime.agent).reserveMarketplacePurchase(
      mandateId, merchant.address, orderId, checkoutExpiresAt, quantity, unitPrice, signature,
    );
    const receipt = await tx.wait();
    const report = this.addReport(runtime, {
      status: "authorized",
      title: "Decision recorded — awaiting merchant capture",
      summary: `${selected.merchant} offered the lowest eligible total under the signed mandate. No mock USD has moved.`,
      recommendation: "The selected seller must verify the mandate-bound checkout before it can capture payment.",
      draft: reportDraftSnapshot(draft),
      mandate: mandateSnapshot,
      agent: { mode: draft.agentMode, model: draft.agentModel, responseId: draft.agentRequestId },
      decision: {
        rationale: `${selected.merchant} has the lowest total among the seller-signed offers that passed every signed mandate limit.`,
        offers: quotes,
        selectedMerchant: selected.merchant,
        selectedAmount: selected.amount,
        savingsVsNextEligible: nextEligible ? (Number(nextEligible.amount) - Number(selected.amount)).toFixed(2) : null,
      },
      authorization: {
        purchaseId,
        orderReference,
        checkoutHash,
        expiresAt: new Date(checkoutExpiresAt * 1000).toISOString(),
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber.toString(),
        status: "reserved",
      },
      verification: null,
      settlement: null,
      balancesBefore,
      mockFundsMoved: false,
    });
    runtime.selectedPurchase = {
      purchaseId,
      mandateId: mandateId.toString(),
      merchant: selected.merchant,
      merchantAddress: merchant.address,
      orderReference,
      quotes,
      selected: { ...selected, merchantAddress: merchant.address },
      status: "Authorized",
      reportId: report.id,
      marketplace: true,
    };
    runtime.marketSearch = {
      status: "authorized",
      searchedAt: new Date().toISOString(),
      evaluatedOffers: quotes,
      advice: [],
      decision: { selectedMerchant: selected.merchant, selectedAmount: selected.amount, reportId: report.id },
    };
    this.audit.push({
      type: "agent_selected_lowest_eligible_quote",
      detail: `Compared ${quotes.map((quote) => `${quote.merchant} (US$${quote.amount})`).join(" and ")}; selected ${selected.merchant} at US$${selected.amount}.`,
      transactionHash: null,
      blockNumber: null,
    });
    this.audit.push({
      type: "merchant_quote_bound_by_agent",
      purchaseId,
      orderReference,
      checkoutHash,
      detail: `${selected.merchant}'s signed checkout is bound to mandate ${mandateId}. The one-use credential is authorized; no money has moved.`,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
    return { status: "authorized", purchaseId, selection: runtime.selectedPurchase, report, state: await this.state() };
  }

  async ensure() {
    if (this.runtime === null) await this.reset();
    return this.runtime;
  }

  async state() {
    const runtime = await this.ensure();
    const latestBlock = await runtime.provider.getBlock("latest");
    const mandateId = runtime.activeMarketplaceMandateId ?? (runtime.staticMandateCreated ? 1n : null);
    const mandate = mandateId === null ? null : await runtime.vault.mandates(mandateId);
    return {
      network: {
        name: "CHK local chain (Ganache)",
        chainId: (await runtime.provider.getNetwork()).chainId.toString(),
        latestBlock: latestBlock.number.toString(),
      },
      contracts: { vault: runtime.vault.target, cardProcessor: runtime.processor.target, mockUsd: runtime.usd.target },
      identities: {
        owner: runtime.owner.address,
        agent: runtime.agent.address,
        merchant: runtime.merchant.address,
        alternateMerchant: runtime.alternateMerchant.address,
      },
      buyer: { ...runtime.buyer, wallet: runtime.owner.address },
      kyc: {
        status: runtime.paymentMethodEnrolled ? "Verified and payment-token enrolled" : "Login required",
        paymentMethodId: runtime.paymentMethodEnrolled ? runtime.paymentMethodId : null,
        credentialHash: runtime.paymentMethodEnrolled ? runtime.kycCredentialHash : null,
        captureReady: runtime.paymentMethodEnrolled,
      },
      mandate: mandate ? {
        id: mandateId.toString(),
        status: ["None", "Active", "Revoked"][Number(mandate.status)],
        productHash: runtime.productHash,
        kycCredentialHash: mandate.kycCredentialHash,
        maxUnitPrice: displayUsd(mandate.maxUnitPrice),
        remainingQuantity: mandate.remainingQuantity.toString(),
        remainingBudget: displayUsd(mandate.remainingBudget),
        expiresAt: new Date(Number(mandate.expiresAt) * 1000).toISOString(),
        revision: mandate.revision.toString(),
        marketplace: runtime.marketplaceMandate,
      } : null,
      balances: {
        buyer: displayUsd(await runtime.usd.balanceOf(runtime.owner.address)),
        cardProcessor: displayUsd(await runtime.usd.balanceOf(runtime.processor.target)),
        merchant: displayUsd(await runtime.usd.balanceOf(runtime.merchant.address)),
        alternateMerchant: displayUsd(await runtime.usd.balanceOf(runtime.alternateMerchant.address)),
      },
      marketplace: {
        catalog: marketplaceCatalog.map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description,
          matchTerms: product.matchTerms,
          offers: product.offers.map((offer) => ({
            ...offer,
            deliveryDays: deliveryDays(offer.delivery),
            wallet: offer.merchant === "OfficeCore" ? runtime.merchant.address : runtime.alternateMerchant.address,
          })),
        })),
        draft: runtime.draft,
        // Compatibility for clients that still read the old intent key.
        intent: runtime.draft,
        signedMandate: runtime.signedMandate,
        marketSearch: runtime.marketSearch,
        selection: runtime.selectedPurchase,
        reports: runtime.reports,
        lastReport: runtime.reports.find((report) => report.id === runtime.lastReportId) ?? null,
        conversation: runtime.conversation,
        agent: {
          mode: runtime.agentMode,
          model: runtime.agentModel,
          requestId: runtime.agentRequestId,
          error: runtime.agentError,
          configured: agentConfigured(),
        },
        activeMandateId: runtime.activeMarketplaceMandateId?.toString() ?? null,
        merchants: [
          { name: "OfficeCore", wallet: runtime.merchant.address, balance: displayUsd(await runtime.usd.balanceOf(runtime.merchant.address)) },
          { name: "SupplyHub", wallet: runtime.alternateMerchant.address, balance: displayUsd(await runtime.usd.balanceOf(runtime.alternateMerchant.address)) },
        ],
      },
      audit: this.audit,
    };
  }

  async reservePurchase({ orderReference, quantity = 1, unitPrice }) {
    const runtime = await this.ensure();
    if (!runtime.mandateCreated) throw new Error("A signed mandate is required before the agent can purchase.");
    const reference = orderReference || `offer-${Date.now()}`;
    const orderId = ethers.id(reference);
    const quotedAt = await runtime.provider.getBlock("latest");
    const checkoutExpiresAt = Number(quotedAt.timestamp) + 5 * 60;
    const parsedUnitPrice = parseUsd(unitPrice, "unitPrice");
    const parsedQuantity = BigInt(quantity);
    const checkoutHash = await runtime.vault.checkoutHashFor(
      1,
      orderId,
      checkoutExpiresAt,
      parsedQuantity,
      parsedUnitPrice,
    );
    const merchantSignature = await runtime.merchant.signMessage(ethers.getBytes(checkoutHash));
    const purchaseId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [1, checkoutHash]),
    );
    const tx = await runtime.vault.connect(runtime.agent).reservePurchase(
      1,
      orderId,
      checkoutExpiresAt,
      parsedQuantity,
      parsedUnitPrice,
      merchantSignature,
    );
    const receipt = await tx.wait();
    this.audit.push({
      type: "merchant_quote_bound_by_agent",
      purchaseId,
      orderReference: reference,
      checkoutHash,
      detail: "VuelaYa's signed checkout was bound to the mandate. A one-use payment authorization exists, but no money moved.",
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
    return { purchaseId, transactionHash: tx.hash, state: await this.state() };
  }

  async verifyPurchase(purchaseId) {
    const runtime = await this.ensure();
    const purchase = await runtime.vault.purchases(purchaseId);
    const mandate = await runtime.vault.mandates(purchase.mandateId);
    const virtualCard = await runtime.processor.virtualCards(purchaseId);
    const active = await runtime.vault.isMandateActive(purchase.mandateId);
    const latestBlock = await runtime.provider.getBlock("latest");
    const marketplacePurchase = runtime.selectedPurchase?.purchaseId === purchaseId && runtime.selectedPurchase.marketplace;
    const merchant = purchase.merchant === ethers.ZeroAddress ? runtime.merchant.address : purchase.merchant;
    const computedCheckoutHash = Number(purchase.status) === 0
      ? ethers.ZeroHash
      : marketplacePurchase
        ? await runtime.vault.marketplaceCheckoutHashFor(
          purchase.mandateId,
          merchant,
          purchase.orderId,
          purchase.checkoutExpiresAt,
          purchase.quantity,
          purchase.unitPrice,
        )
        : await runtime.vault.checkoutHashFor(
          purchase.mandateId,
          purchase.orderId,
          purchase.checkoutExpiresAt,
          purchase.quantity,
          purchase.unitPrice,
        );
    const checks = {
      knownPurchase: Number(purchase.status) !== 0,
      mandateActive: active,
      merchantMatches: marketplacePurchase
        ? await runtime.vault.isMerchantAllowed(purchase.mandateId, merchant)
        : mandate.merchant.toLowerCase() === runtime.merchant.address.toLowerCase(),
      kycPaymentMethodBound: await runtime.processor.isVerifiedPaymentMethod(mandate.owner, mandate.paymentMethodId),
      buyerCredentialMatches: mandate.kycCredentialHash === runtime.kycCredentialHash,
      merchantSignedCheckoutBound: purchase.checkoutHash === computedCheckoutHash,
      checkoutStillValid: Number(purchase.checkoutExpiresAt) >= Number(latestBlock.timestamp),
      authorizationReserved: Number(purchase.status) === 1,
      authorizationCurrent: purchase.mandateRevision === mandate.revision,
      virtualCardAuthorized: Number(virtualCard.status) === 1,
    };
    const result = {
      purchaseId,
      verified: Object.values(checks).every(Boolean),
      checks,
      purchase: {
        amount: displayUsd(purchase.amount),
        quantity: purchase.quantity.toString(),
        unitPrice: displayUsd(purchase.unitPrice),
        merchant,
        mandateRevision: purchase.mandateRevision.toString(),
        checkoutHash: purchase.checkoutHash,
        checkoutExpiresAt: new Date(Number(purchase.checkoutExpiresAt) * 1000).toISOString(),
      },
      mandateRevision: mandate.revision.toString(),
    };
    const report = runtime.reports.find((entry) => entry.authorization?.purchaseId === purchaseId);
    if (report) {
      report.verification = {
        checkedAt: new Date().toISOString(),
        verified: result.verified,
        checks,
        purchase: result.purchase,
      };
      report.updatedAt = new Date().toISOString();
    }
    return result;
  }

  async capturePurchase(purchaseId) {
    const runtime = await this.ensure();
    const verification = await this.verifyPurchase(purchaseId);
    if (!verification.verified) throw new Error("Merchant verification failed; capture was not attempted.");
    const purchase = await runtime.vault.purchases(purchaseId);
    const merchantAddress = purchase.merchant === ethers.ZeroAddress ? runtime.merchant.address : purchase.merchant;
    const merchant = merchantAddress.toLowerCase() === runtime.alternateMerchant.address.toLowerCase()
      ? runtime.alternateMerchant
      : runtime.merchant;
    const balancesBefore = await reportWalletBalances(runtime);
    const tx = await runtime.vault.connect(merchant).settlePurchase(purchaseId);
    const receipt = await tx.wait();
    const balancesAfter = await reportWalletBalances(runtime);
    const settlementBlock = await runtime.provider.getBlock(receipt.blockNumber);
    this.audit.push({
      type: "merchant_captured_purchase",
      purchaseId,
      detail: `${runtime.selectedPurchase?.merchant ?? "Merchant"} captured the one-use credential and received the mock USD payment.`,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
    if (runtime.selectedPurchase?.purchaseId === purchaseId) {
      runtime.selectedPurchase.status = "Settled";
      runtime.selectedPurchase.settlement = { transactionHash: tx.hash, blockNumber: receipt.blockNumber.toString() };
      runtime.marketSearch = { ...runtime.marketSearch, status: "settled" };
      const report = runtime.reports.find((entry) => entry.id === runtime.selectedPurchase.reportId);
      if (report) {
        report.status = "settled";
        report.title = "Settlement complete";
        report.summary = `${runtime.selectedPurchase.merchant} captured the verified one-use credential. Mock USD moved only at settlement.`;
        report.mockFundsMoved = true;
        report.settlement = {
          transactionHash: tx.hash,
          blockNumber: receipt.blockNumber.toString(),
          settledAt: new Date(Number(settlementBlock.timestamp) * 1000).toISOString(),
          amount: runtime.selectedPurchase.selected.amount,
          balances: {
            buyer: balanceMovement(balancesBefore.buyer, balancesAfter.buyer),
            OfficeCore: balanceMovement(balancesBefore.OfficeCore, balancesAfter.OfficeCore),
            SupplyHub: balanceMovement(balancesBefore.SupplyHub, balancesAfter.SupplyHub),
          },
        };
        report.updatedAt = new Date().toISOString();
      }
      runtime.conversation.push({
        role: "assistant",
        content: `Payment complete: ${runtime.selectedPurchase.merchant} received US$${runtime.selectedPurchase.selected.amount}. What would you like to buy next?`,
      });
    }
    return { purchaseId, transactionHash: tx.hash, state: await this.state() };
  }

  async amendPriceCap(maxUnitPrice) {
    const runtime = await this.ensure();
    const mandateId = runtime.activeMarketplaceMandateId ?? 1;
    const tx = await runtime.vault.connect(runtime.owner).amendMaxUnitPrice(mandateId, parseUsd(maxUnitPrice, "maxUnitPrice"));
    const receipt = await tx.wait();
    this.audit.push({
      type: "mandate_price_cap_amended",
      maxUnitPrice: String(maxUnitPrice),
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
    return this.state();
  }

  async revokeMandate() {
    const runtime = await this.ensure();
    const mandateId = runtime.activeMarketplaceMandateId ?? 1;
    const tx = await runtime.vault.connect(runtime.owner).revokeMandate(mandateId);
    const receipt = await tx.wait();
    this.audit.push({ type: "mandate_revoked", transactionHash: tx.hash, blockNumber: receipt.blockNumber });
    return this.state();
  }

  async releasePurchase(purchaseId) {
    const runtime = await this.ensure();
    const tx = await runtime.vault.connect(runtime.owner).releasePurchase(purchaseId);
    const receipt = await tx.wait();
    this.audit.push({
      type: "unused_authorization_released",
      purchaseId,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
    return this.state();
  }
}

export { errorMessage };
