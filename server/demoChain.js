import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import { ethers } from "ethers";
import solc from "solc";
import {
  canonicalFlightTerms,
  evaluateFlightOffer,
  flightMerchants,
  searchFlights,
} from "./mockFlights.js";
import { agentReply } from "./agent/reply.js";
import { createLlmClient, loadEnvFile } from "./agent/llm.js";
import { runAgent } from "./agent/run.js";

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(__dirname, "..");
const USD_DECIMALS = 6;
const DEFAULT_BUYER = { name: "Marta Ruiz", email: "marta@chk.demo", company: "Marta Studio" };

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
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources,
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  })));
  const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
  if (errors.length) throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
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
    const parsed = ethers.parseUnits(String(value), USD_DECIMALS);
    if (parsed <= 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be a positive USD amount, for example "150".`);
  }
}

function displayUsd(amount) {
  return ethers.formatUnits(amount, USD_DECIMALS);
}

function errorMessage(error) {
  return error?.info?.error?.message || error?.shortMessage || error?.message || "Transaction failed";
}

function nowIso() {
  return new Date().toISOString();
}

function isIsoDate(value) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

function mandateExpiryUnix(value) {
  if (!isIsoDate(value)) throw new Error("Mandate validity must be a date in YYYY-MM-DD format.");
  const timestamp = Date.parse(`${value}T23:59:59.000Z`);
  if (!Number.isFinite(timestamp)) throw new Error("Mandate validity is not a valid date.");
  return Math.floor(timestamp / 1000);
}

function revisionFor(previous) {
  return Number(previous?.revision ?? 0) + 1;
}

function questionsFor(draft) {
  const questions = [];
  if (!String(draft.productName ?? "").trim()) questions.push({ field: "productName", question: "What flight should I look for?" });
  if (!String(draft.budget ?? "").trim() || Number(draft.budget) <= 0) questions.push({ field: "budget", question: "What is the maximum total budget in USD?" });
  if (!Number.isInteger(Number(draft.quantity)) || Number(draft.quantity) < 1) questions.push({ field: "quantity", question: "How many tickets should the mandate allow?" });
  if (!String(draft.seller ?? "").trim()) questions.push({ field: "seller", question: "Should I prefer a specific airline, or may I compare any airline?" });
  if (!String(draft.origin ?? "").trim()) questions.push({ field: "origin", question: "What is the flight origin?" });
  if (!String(draft.destination ?? "").trim()) questions.push({ field: "destination", question: "What is the flight destination?" });
  if (!isIsoDate(draft.departureDate)) questions.push({ field: "departureDate", question: "What is the departure date?" });
  if (!isIsoDate(draft.authorizationExpiresAt)) questions.push({ field: "authorizationExpiresAt", question: "Until what date may this mandate authorize a purchase?" });
  return questions;
}

function budgetCap(budget, quantity) {
  const total = parseUsd(budget, "Budget");
  const tickets = BigInt(quantity);
  if (tickets <= 0n) throw new Error("Tickets must be a positive whole number.");
  return displayUsd(total / tickets);
}

/**
 * The per-ticket cap is a function of budget and tickets, and of nothing else.
 *
 * It used to be derived only once the whole draft was `ready`, so a buyer who
 * had already entered a budget and a ticket count still saw "waiting for
 * budget" while some unrelated field - an airline preference, a validity date -
 * was outstanding. That reads as the budget being rejected and hides what is
 * actually blocking the signature.
 *
 * This value is a preview and never the authority: createMarketplaceMandate
 * recomputes budget/quantity on its own, with the same integer division, and
 * still refuses to sign anything whose status is not "reviewed".
 */
function derivedUnitCap(draft) {
  const budget = String(draft.budget ?? "").trim();
  const quantity = Number(draft.quantity);
  if (!budget || !Number.isInteger(quantity) || quantity < 1) return null;
  try {
    return budgetCap(budget, quantity);
  } catch {
    // A budget that is not a positive USD amount already has its own entry in
    // questionsFor. It must not throw out of drafting.
    return null;
  }
}

function draftStatus(draft) {
  return questionsFor(draft).length === 0 ? "ready" : "needs_input";
}

/**
 * Build a mandate draft from terms, and only from terms.
 *
 * Nothing here re-reads the buyer's prose. Comprehension happens once, in the
 * agent's intent module, and its typed output arrives as `terms`; form edits
 * arrive the same way. The previous design re-parsed the free-text Product
 * Name on every revision, so typing a name into the form could silently
 * rewrite the route and date fields underneath it.
 *
 * An absent term leaves the previous value alone. An empty string clears it -
 * that is a human deleting a field, which is different from not mentioning it.
 */
function draftFromTerms({ previous = null, terms = {}, prompt = null }) {
  const keep = (field, fallback = "") => {
    const value = terms[field];
    if (value === undefined || value === null) return previous?.[field] ?? fallback;
    return typeof value === "string" ? value.trim() : value;
  };

  const next = {
    id: previous?.id ?? `flight-draft-${Date.now()}`,
    revision: revisionFor(previous),
    prompt: String(prompt ?? previous?.prompt ?? "").trim(),
    productName: String(keep("productName")).trim(),
    origin: String(keep("origin")).trim(),
    destination: String(keep("destination")).trim(),
    departureDate: String(keep("departureDate")).trim(),
    authorizationExpiresAt: String(keep("authorizationExpiresAt")).trim(),
    seller: String(keep("seller")).trim(),
    quantity: Number(keep("quantity", 1)),
    budget: String(keep("budget")).trim(),
    cabin: String(keep("cabin", "Economy")).trim() || "Economy",
    maxStops: Number(keep("maxStops", 0)),
    createdAt: previous?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    history: [...(previous?.history ?? [])],
  };

  next.status = draftStatus(next);
  next.questions = questionsFor(next);
  next.maxUnitPrice = derivedUnitCap(next);
  next.history.push({
    revision: next.revision,
    at: next.updatedAt,
    summary: next.status === "ready"
      ? `Flight mandate draft prepared for ${next.quantity} ticket(s) to ${next.destination}.`
      : "Flight request needs a human-validated mandate field.",
  });
  return next;
}

/**
 * The typed intent, mapped onto the mandate form.
 *
 * Only terms the human actually gave cross over, and a term the model did not
 * extract arrives as null so `draftFromTerms` leaves the previous value alone.
 * That matters: the buyer types some mandate fields directly into the form -
 * the authorization expiry is never inferable from a travel request at all -
 * and a later chat turn must not quietly wipe them.
 *
 * The agent's search brief may fill a reference passenger count in order to
 * total a price. That reference value is deliberately not copied here, because
 * this draft becomes spend authority the moment it is signed.
 */
function termsFromIntent(intent) {
  const { trip, constraints } = intent;
  return {
    productName: trip.origin && trip.destination
      ? `Flight from ${trip.origin} to ${trip.destination}`
      : trip.destination
        ? `Flight to ${trip.destination}`
        : null,
    origin: trip.origin,
    destination: trip.destination,
    departureDate: trip.departureDate,
    authorizationExpiresAt: constraints.authorizationExpiresAt,
    seller: trip.airlinePreference,
    quantity: trip.passengers,
    budget: constraints.budgetUsd === null ? null : constraints.budgetUsd.toFixed(2),
    cabin: trip.cabin,
    maxStops: trip.maxStops,
  };
}

function reportDraft(draft) {
  if (!draft) return null;
  return {
    revision: draft.revision,
    productName: draft.productName,
    route: `${draft.origin} → ${draft.destination}`,
    departureDate: draft.departureDate,
    validThrough: draft.authorizationExpiresAt,
    seller: draft.seller,
    tickets: draft.quantity,
    unitPriceCap: draft.maxUnitPrice,
    totalBudget: draft.budget,
  };
}

function balanceMovement(before, after) {
  const delta = Number(after) - Number(before);
  return { before, after, delta: `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}` };
}

async function balances(runtime) {
  return {
    buyer: displayUsd(await runtime.usd.balanceOf(runtime.owner.address)),
    VuelaYa: displayUsd(await runtime.usd.balanceOf(runtime.merchant.address)),
    SkyLink: displayUsd(await runtime.usd.balanceOf(runtime.alternateMerchant.address)),
  };
}

function merchantFor(runtime, name) {
  if (name === "VuelaYa") return runtime.merchant;
  if (name === "SkyLink") return runtime.alternateMerchant;
  throw new Error(`Unknown mock flight merchant: ${name}.`);
}

function serializableOffer(offer) {
  return {
    quoteId: offer.quoteId,
    merchant: offer.merchant,
    airline: offer.airline,
    route: `${offer.origin} → ${offer.destination}`,
    origin: offer.origin,
    destination: offer.destination,
    departureDate: offer.departureDate,
    departureTime: offer.departureTime,
    arrivalTime: offer.arrivalTime,
    cabin: offer.cabin,
    stops: offer.stops,
    seats: offer.seats,
    unitPrice: offer.unitPrice,
    amount: offer.amount,
    eligible: offer.eligible,
    rejectionReasons: offer.rejectionReasons,
  };
}

/**
 * In-memory demonstration adapter. The chain is the authority for the signed
 * mandate and payment authorization. Search results are deliberately mock
 * data and can be replaced by a provider that returns the same offer shape.
 */
export class DemoChain {
  constructor({ llm = createLlmClient() } = {}) {
    this.runtime = null;
    this.audit = [];
    // The single door to the model. Tests hand in a scripted client, so the
    // agent's behaviour can be checked offline, free, and identically.
    this.llm = llm;
  }

  async reset() {
    const ganacheProvider = ganache.provider({ logging: { quiet: true } });
    const provider = new ethers.BrowserProvider(ganacheProvider);
    const wallets = Object.values(ganacheProvider.getInitialAccounts()).map(({ secretKey }) => {
      const wallet = new ethers.Wallet(secretKey, provider);
      const signer = new ethers.NonceManager(wallet);
      signer.address = wallet.address;
      return signer;
    });
    const [owner, agent, merchant, alternateMerchant, imposter] = wallets;
    const usd = await deploy(owner, "contracts/MockUSD.sol", "MockUSD");
    const processor = await deploy(owner, "contracts/MockCardProcessor.sol", "MockCardProcessor", [usd.target]);
    const vault = await deploy(owner, "contracts/MandateVault.sol", "MandateVault", [processor.target]);
    await (await processor.setVault(vault.target)).wait();
    await (await usd.mint(owner.address, parseUsd("2000", "Seed balance"))).wait();

    this.runtime = {
      provider,
      owner,
      agent,
      merchant,
      alternateMerchant,
      imposter,
      usd,
      processor,
      vault,
      buyer: { ...DEFAULT_BUYER },
      paymentMethodId: null,
      kycCredentialHash: null,
      paymentMethodEnrolled: false,
      draft: null,
      signedMandate: null,
      activeMandateId: null,
      lastMandateId: null,
      archivedSignedMandate: null,
      selectedPurchase: null,
      search: { status: "not_started", offers: [], trace: [] },
      suggestion: null,
      clarification: null,
      agentSeq: 0,
      reports: [],
      lastReportId: null,
      trial: null,
      trials: [],
      conversation: [],
    };
    const deployment = vault.deploymentTransaction();
    const receipt = await deployment.wait();
    this.audit = [{
      type: "local_payment_stack_deployed",
      detail: "Local mandate vault, KYC-token provider, merchant wallets, and mock USD are ready.",
      transactionHash: deployment.hash,
      blockNumber: receipt.blockNumber.toString(),
    }];
    return this.state();
  }

  async ensure() {
    if (!this.runtime) await this.reset();
    return this.runtime;
  }

  addReport(runtime, report) {
    const record = {
      id: `RPT-${String(runtime.reports.length + 1).padStart(3, "0")}`,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...report,
    };
    runtime.reports.push(record);
    runtime.lastReportId = record.id;
    return record;
  }

  async loginAndEnrollBuyer(profile = {}) {
    const runtime = await this.ensure();
    if (runtime.paymentMethodEnrolled) throw new Error("Mock KYC and payment-token enrollment are already complete.");

    const name = String(profile.name ?? runtime.buyer.name).trim();
    const email = String(profile.email ?? runtime.buyer.email).trim();
    const company = String(profile.company ?? runtime.buyer.company).trim();
    if (!name || !email || !company) throw new Error("Name, email, and company are required for mock KYC.");

    runtime.buyer = { name, email, company };
    runtime.paymentMethodId = ethers.id(`demo-payment-method:${email.toLowerCase()}`);
    runtime.kycCredentialHash = ethers.id(`demo-kyc:${name.toLowerCase()}:${email.toLowerCase()}:${company.toLowerCase()}`);
    const enrollment = await runtime.processor.connect(runtime.owner).registerVerifiedPaymentMethod(
      runtime.paymentMethodId,
      runtime.owner.address,
      runtime.kycCredentialHash,
    );
    const enrollmentReceipt = await enrollment.wait();
    const consent = await runtime.usd.connect(runtime.owner).approve(runtime.processor.target, ethers.MaxUint256);
    const consentReceipt = await consent.wait();
    runtime.paymentMethodEnrolled = true;
    this.audit.push({
      type: "kyc_payment_token_enrolled",
      detail: `${name} completed mock KYC and enrolled an opaque payment token. No raw card data or funds were exposed.`,
      transactionHash: enrollment.hash,
      blockNumber: enrollmentReceipt.blockNumber.toString(),
    }, {
      type: "capture_consent_recorded",
      detail: "The mock payment method may be charged only after a current on-chain authorization passes merchant verification.",
      transactionHash: consent.hash,
      blockNumber: consentReceipt.blockNumber.toString(),
    });
    return this.state();
  }

  async archiveClosedMandate(runtime) {
    if (runtime.activeMandateId === null) return false;
    const mandate = await runtime.vault.mandates(runtime.activeMandateId);
    const stillActive = await runtime.vault.isMandateActive(runtime.activeMandateId);
    const settled = runtime.selectedPurchase?.status === "Settled";
    const exhausted = mandate.remainingQuantity === 0n || mandate.remainingBudget === 0n;
    if (stillActive && !settled && !exhausted) return false;

    runtime.lastMandateId = runtime.activeMandateId;
    runtime.archivedSignedMandate = runtime.signedMandate;
    runtime.activeMandateId = null;
    runtime.signedMandate = null;
    return true;
  }

  recordTrial(runtime, trial, auditType, detail) {
    runtime.trial = trial;
    runtime.trials.push(trial);
    this.audit.push({ type: auditType, detail, transactionHash: null, blockNumber: null });
  }

  eligibleTrialCandidate(runtime) {
    const candidate = searchFlights(runtime.draft).offers
      .map((offer) => evaluateFlightOffer(offer, { ...runtime.draft, status: "signed" }))
      .find((offer) => offer.eligible);
    if (!candidate) throw new Error("No compliant mock flight is available for this trial.");
    return candidate;
  }

  /**
   * The only channel the agent module has to the outside world: a clock, an id
   * source, and the audit trail. No vault, no wallets, no merchant. What the
   * agent cannot do is a property of what it was handed, not of a flag it
   * promises to check.
   */
  agentContext(runtime) {
    return {
      now: () => new Date(),
      nextId: (prefix) => {
        runtime.agentSeq += 1;
        return `${prefix}-${String(runtime.agentSeq).padStart(3, "0")}`;
      },
      audit: (event) => {
        this.audit.push({ ...event, transactionHash: null, blockNumber: null });
      },
    };
  }

  /**
   * Read the signed mandate once, here, where chain access lives. `usable`
   * folds together every reason the mandate might not authorize anything -
   * revoked, expired, out of tickets, out of budget - so the agent never has to
   * interpret chain state it cannot see.
   */
  async readMandateForAgent(runtime) {
    if (runtime.activeMandateId === null) return null;
    const record = await runtime.vault.mandates(runtime.activeMandateId);
    const active = await runtime.vault.isMandateActive(runtime.activeMandateId);
    return {
      id: runtime.activeMandateId.toString(),
      usable: active && record.remainingQuantity > 0n && record.remainingBudget > 0n,
      terms: runtime.signedMandate ?? null,
    };
  }

  say(runtime, content) {
    runtime.conversation.push({ role: "assistant", content });
    return content;
  }

  /**
   * One buyer turn.
   *
   * Everything this method does with the result is bookkeeping. The decision
   * itself - ask, suggest, or book - is made by the commitment gate in
   * agent/run.js, and this method cannot reach past it: a suggestion has no
   * path to the vault from here.
   */
  async recordIntent({ prompt }) {
    const runtime = await this.ensure();
    const message = String(prompt ?? "").trim();
    if (!message) throw new Error("Write a message for the agent.");
    runtime.conversation.push({ role: "user", content: message });

    const mandate = await this.readMandateForAgent(runtime);
    let decision;
    try {
      decision = await runAgent({
        message,
        conversation: runtime.conversation,
        mandate,
        llm: this.llm,
        ctx: this.agentContext(runtime),
      });
    } catch (error) {
      // A comprehension failure must not degrade into a guess. The run stops
      // and says so, and nothing downstream has moved.
      this.audit.push({
        type: "agent_run_failed",
        detail: `The agent could not understand this turn safely and did nothing: ${errorMessage(error)}`,
        transactionHash: null,
        blockNumber: null,
      });
      const reply = this.say(runtime, `I could not process that safely, so I did nothing: ${errorMessage(error)}`);
      return { kind: "error", reply, state: await this.state() };
    }

    const reply = agentReply(decision);

    if (decision.kind === "clarification") {
      runtime.clarification = { questions: decision.questions, partial: decision.partial, askedAt: nowIso() };
      runtime.suggestion = null;
      this.say(runtime, reply);
      return { kind: "clarification", reply, questions: decision.questions, state: await this.state() };
    }

    runtime.clarification = null;

    if (decision.kind === "purchase_order") {
      this.say(runtime, reply);
      // The gate said this is an order over a usable mandate. The mandate still
      // decides: compareAndAuthorize re-reads it and can refuse.
      try {
        const executed = await this.compareAndAuthorize();
        this.say(runtime, executed.status === "authorized"
          ? `Authorized ${executed.selection.selected.airline} ${executed.selection.selected.quoteId} for US$${executed.selection.selected.amount} against mandate #${mandate.id}. The funds are held, not captured - the merchant captures after it verifies.`
          : "No itinerary met your signed mandate, so I authorized nothing. Amend the mandate or widen the terms and ask me again.");
        return { kind: "purchase", reply, ...executed };
      } catch (error) {
        const refusal = this.say(runtime, `Your mandate did not allow that: ${errorMessage(error)}`);
        return { kind: "blocked", reply: refusal, state: await this.state() };
      }
    }

    // A suggestion. The agent compared real itineraries and spent nothing. The
    // editable draft it opens alongside is the thing that could become spend
    // authority, and only a human signature does that.
    runtime.suggestion = {
      reason: decision.reason,
      detail: decision.detail,
      best: decision.best,
      options: decision.options,
      overBudget: decision.overBudget,
      rejected: decision.rejected,
      trace: decision.trace,
      brief: decision.brief,
      commitment: decision.intent.commitment,
      preparedAt: nowIso(),
    };

    if (runtime.activeMandateId === null || (await this.archiveClosedMandate(runtime))) {
      const previous = ["signed", "revoked", "expired"].includes(runtime.draft?.status) ? null : runtime.draft;
      runtime.draft = draftFromTerms({
        previous,
        terms: termsFromIntent(decision.intent),
        prompt: message,
      });
      runtime.draft.reply = reply;
      runtime.search = { status: "not_started", offers: [], trace: [] };
      runtime.selectedPurchase = null;
      this.audit.push({
        type: runtime.draft.status === "ready" ? "flight_mandate_draft_created" : "flight_mandate_needs_input",
        detail: runtime.draft.status === "ready"
          ? `Draft v${runtime.draft.revision} carries only terms the buyer gave. It is not spend authority until signed.`
          : `Draft v${runtime.draft.revision} is missing mandate fields the buyer must supply before it can be signed.`,
        transactionHash: null,
        blockNumber: null,
      });
    }

    this.say(runtime, reply);
    return { kind: "suggestion", reply, draft: runtime.draft, suggestion: runtime.suggestion, state: await this.state() };
  }

  async reviseDraft(changes = {}) {
    const runtime = await this.ensure();
    if (!runtime.draft) throw new Error("Ask the agent for a purchase first so there is a mandate draft to edit.");
    if (runtime.activeMandateId !== null && !(await this.archiveClosedMandate(runtime))) throw new Error("A signed mandate cannot be edited in place. Revoke it, then start a new draft.");
    const previous = runtime.draft;
    runtime.draft = draftFromTerms({ previous, terms: changes, prompt: previous.prompt });
    runtime.search = { status: "not_started", offers: [], trace: [] };
    this.audit.push({
      type: "flight_mandate_draft_edited",
      detail: `Buyer edited flight mandate draft v${runtime.draft.revision}. It remains non-spend authority until confirmed and signed.`,
      transactionHash: null,
      blockNumber: null,
    });
    runtime.conversation.push({ role: "assistant", content: runtime.draft.status === "ready"
      ? `Draft v${runtime.draft.revision} is ready to review. I will use only these terms if you confirm and sign it.`
      : `Draft v${runtime.draft.revision} still needs the required field${runtime.draft.questions.length === 1 ? "" : "s"}.` });
    return this.state();
  }

  async confirmDraft() {
    const runtime = await this.ensure();
    if (runtime.draft?.status !== "ready") throw new Error("Complete the flight mandate fields before confirming it.");
    runtime.draft = { ...runtime.draft, status: "reviewed", questions: [], updatedAt: nowIso() };
    this.audit.push({
      type: "flight_mandate_confirmed",
      detail: `Buyer confirmed exact flight mandate draft v${runtime.draft.revision}; it is still not spend authority until signed.`,
      transactionHash: null,
      blockNumber: null,
    });
    runtime.conversation.push({ role: "assistant", content: "Terms confirmed. Sign this exact mandate to grant the agent limited search-and-authorize authority. No payment happens when you sign." });
    return this.state();
  }

  async createMarketplaceMandate() {
    const runtime = await this.ensure();
    const draft = runtime.draft;
    if (!runtime.paymentMethodEnrolled) throw new Error("Complete mock KYC before signing a mandate.");
    if (draft?.status !== "reviewed") throw new Error("Review and confirm the exact flight draft before signing it.");
    if (runtime.activeMandateId !== null) throw new Error("A flight mandate is already active.");

    const quantity = BigInt(draft.quantity);
    const budget = parseUsd(draft.budget, "Budget");
    const maxUnitPrice = budget / quantity;
    const latest = await runtime.provider.getBlock("latest");
    const expiresAt = mandateExpiryUnix(draft.authorizationExpiresAt);
    if (expiresAt <= Number(latest.timestamp)) throw new Error("Mandate validity must be in the future before it can be signed.");
    const terms = canonicalFlightTerms({ ...draft, maxUnitPrice: displayUsd(maxUnitPrice) });
    const productHash = ethers.id(JSON.stringify(terms));
    const tx = await runtime.vault.connect(runtime.owner).createMarketplaceMandate(
      runtime.agent.address,
      [runtime.merchant.address, runtime.alternateMerchant.address],
      runtime.paymentMethodId,
      productHash,
      quantity,
      maxUnitPrice,
      budget,
      expiresAt,
    );
    const receipt = await tx.wait();
    const mandateId = (await runtime.vault.nextMandateId()) - 1n;
    runtime.activeMandateId = mandateId;
    runtime.lastMandateId = mandateId;
    const signing = {
      mandateId: mandateId.toString(),
      productHash,
      constraintHash: productHash,
      terms,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
    runtime.draft = {
      ...draft,
      status: "signed",
      maxUnitPrice: displayUsd(maxUnitPrice),
      signing,
      updatedAt: nowIso(),
    };
    runtime.signedMandate = signing;
    this.audit.push({
      type: "flight_mandate_signed",
      detail: `Flight constraints were signed on-chain as mandate ${mandateId}. The agent can compare only approved merchants and prices within these limits.`,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
    });
    runtime.conversation.push({ role: "assistant", content: `Mandate #${mandateId} is live through ${draft.authorizationExpiresAt}. I can now run a mock flight search, but VuelaYa or SkyLink must verify before any mock payment is captured.` });
    return this.state();
  }

  async compareAndAuthorize() {
    const runtime = await this.ensure();
    const draft = runtime.draft;
    if (draft?.status !== "signed" || runtime.activeMandateId === null) throw new Error("Sign a flight mandate before the agent can search.");
    if (!(await runtime.vault.isMandateActive(runtime.activeMandateId))) throw new Error("This flight mandate is no longer active, so the agent will not search or authorize a purchase.");
    if (runtime.selectedPurchase) throw new Error("This session already has an authorized itinerary. Verify/capture it or reset the demo.");

    const scraped = searchFlights(draft);
    const offers = scraped.offers.map((offer) => evaluateFlightOffer(offer, draft));
    const eligible = offers.filter((offer) => offer.eligible).sort((left, right) => (
      Number(left.amount) - Number(right.amount)
      || left.departureTime.localeCompare(right.departureTime)
    ));
    runtime.search = { status: eligible.length ? "evaluated" : "no_eligible_option", offers: offers.map(serializableOffer), trace: scraped.trace, searchedAt: nowIso() };

    if (!eligible.length) {
      const report = this.addReport(runtime, {
        status: "not_executed",
        title: "No itinerary met the signed mandate",
        summary: `The mock scraper found ${offers.length} itinerary option(s), but every option violated at least one signed flight term. No authorization or payment was created.`,
        draft: reportDraft(draft),
        decision: { selectedMerchant: null, offers: offers.map(serializableOffer), rationale: "Policy rejected every scraped offer before the on-chain authorization call." },
        authorization: null,
        verification: null,
        settlement: null,
        trace: scraped.trace,
      });
      this.audit.push({ type: "flight_search_no_eligible_option", detail: report.summary, transactionHash: null, blockNumber: null });
      // Name the terms that actually rejected the offers. "Every option violated
      // at least one signed term" is true and useless: the buyer cannot tell a
      // per-ticket cap set too low from an airline name that matches nothing.
      const reasons = [...new Set(offers.flatMap((offer) => offer.rejectionReasons))].slice(0, 3);
      runtime.conversation.push({
        role: "assistant",
        content: `I found ${offers.length} itinerary option(s), but none satisfies the mandate you signed. ${reasons.join(" ")} I did not create an authorization or move money. Sign a new mandate if you want different terms.`,
      });
      return { status: "no_eligible_option", report, state: await this.state() };
    }

    const selected = eligible[0];
    const merchant = merchantFor(runtime, selected.merchant);
    const mandateId = runtime.activeMandateId;
    const orderReference = selected.quoteId;
    const orderId = ethers.id(orderReference);
    const latest = await runtime.provider.getBlock("latest");
    const checkoutExpiresAt = Number(latest.timestamp) + 5 * 60;
    const unitPrice = parseUsd(selected.unitPrice, "Flight fare");
    const checkoutHash = await runtime.vault.marketplaceCheckoutHashFor(
      mandateId, merchant.address, orderId, checkoutExpiresAt, BigInt(draft.quantity), unitPrice,
    );
    const signature = await merchant.signMessage(ethers.getBytes(checkoutHash));
    const purchaseId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [mandateId, checkoutHash]));
    const before = await balances(runtime);
    const tx = await runtime.vault.connect(runtime.agent).reserveMarketplacePurchase(
      mandateId, merchant.address, orderId, checkoutExpiresAt, BigInt(draft.quantity), unitPrice, signature,
    );
    const receipt = await tx.wait();
    const report = this.addReport(runtime, {
      status: "authorized",
      title: "Flight selected - awaiting merchant verification",
      summary: `${selected.merchant} returned the lowest eligible ${selected.airline} itinerary. The exact quote is bound to the signed mandate; no mock USD has moved.`,
      draft: reportDraft(draft),
      decision: {
        selectedMerchant: selected.merchant,
        rationale: "The agent selected the lowest total among mock-scraped itineraries that matched every signed term.",
        offers: offers.map(serializableOffer),
      },
      authorization: { purchaseId, orderReference, checkoutHash, transactionHash: tx.hash, blockNumber: receipt.blockNumber.toString(), expiresAt: new Date(checkoutExpiresAt * 1000).toISOString() },
      verification: null,
      settlement: null,
      trace: scraped.trace,
    });
    runtime.selectedPurchase = {
      purchaseId,
      mandateId: mandateId.toString(),
      orderReference,
      merchant: selected.merchant,
      merchantAddress: merchant.address,
      selected: serializableOffer(selected),
      status: "Authorized",
      constraintHash: runtime.signedMandate.constraintHash,
      reportId: report.id,
    };
    runtime.search.status = "authorized";
    runtime.search.selectedQuoteId = selected.quoteId;
    this.audit.push({
      type: "agent_selected_eligible_flight",
      detail: `Mock scraper evaluated ${offers.length} itinerary option(s) and selected ${selected.quoteId} at US$${selected.amount}.`,
      transactionHash: null,
      blockNumber: null,
    }, {
      type: "merchant_checkout_bound_on_chain",
      detail: `${selected.merchant}'s signed quote is bound to mandate ${mandateId}; the one-use payment credential is authorized, not captured.`,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
    });
    runtime.conversation.push({ role: "assistant", content: `I found an eligible ${selected.airline} flight at US$${selected.amount} total. The quote is authorized on-chain, but ${selected.merchant} must independently verify it before it can charge your mock payment method.` });
    return { status: "authorized", purchaseId, selection: runtime.selectedPurchase, report, balancesBefore: before, state: await this.state() };
  }

  async verifyPurchase(purchaseId) {
    const runtime = await this.ensure();
    const purchase = await runtime.vault.purchases(purchaseId);
    const mandate = await runtime.vault.mandates(purchase.mandateId);
    const virtualCard = await runtime.processor.virtualCards(purchaseId);
    const merchant = purchase.merchant;
    const latest = await runtime.provider.getBlock("latest");
    const expectedHash = Number(purchase.status) === 0
      ? ethers.ZeroHash
      : await runtime.vault.marketplaceCheckoutHashFor(
        purchase.mandateId, merchant, purchase.orderId, purchase.checkoutExpiresAt, purchase.quantity, purchase.unitPrice,
      );
    const selected = runtime.selectedPurchase?.purchaseId === purchaseId ? runtime.selectedPurchase.selected : null;
    const flightStillMatches = selected ? evaluateFlightOffer({
      quoteId: selected.quoteId,
      merchant: selected.merchant,
      airline: selected.airline,
      origin: selected.origin,
      destination: selected.destination,
      departureDate: selected.departureDate,
      departureTime: selected.departureTime,
      arrivalTime: selected.arrivalTime,
      cabin: selected.cabin,
      stops: selected.stops,
      seats: selected.seats,
      unitPrice: selected.unitPrice,
    }, runtime.draft).eligible : false;
    const checks = {
      knownPurchase: Number(purchase.status) !== 0,
      mandateActive: await runtime.vault.isMandateActive(purchase.mandateId),
      merchantAllowed: await runtime.vault.isMerchantAllowed(purchase.mandateId, merchant),
      kycPaymentMethodBound: await runtime.processor.isVerifiedPaymentMethod(mandate.owner, mandate.paymentMethodId),
      buyerCredentialMatches: mandate.kycCredentialHash === runtime.kycCredentialHash,
      checkoutHashMatches: purchase.checkoutHash === expectedHash,
      checkoutStillValid: Number(purchase.checkoutExpiresAt) >= Number(latest.timestamp),
      authorizationReserved: Number(purchase.status) === 1,
      mandateRevisionCurrent: purchase.mandateRevision === mandate.revision,
      virtualCardAuthorized: Number(virtualCard.status) === 1,
      flightConstraintHashMatches: mandate.productHash === runtime.signedMandate?.constraintHash,
      selectedFlightStillWithinTerms: flightStillMatches,
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
        checkoutExpiresAt: new Date(Number(purchase.checkoutExpiresAt) * 1000).toISOString(),
      },
    };
    const report = runtime.reports.find((entry) => entry.authorization?.purchaseId === purchaseId);
    if (report) {
      report.verification = { checkedAt: nowIso(), verified: result.verified, checks, purchase: result.purchase };
      report.updatedAt = nowIso();
    }
    return result;
  }

  async capturePurchase(purchaseId) {
    const runtime = await this.ensure();
    const verification = await this.verifyPurchase(purchaseId);
    if (!verification.verified) throw new Error("Merchant verification failed; mock payment was not captured.");
    const purchase = await runtime.vault.purchases(purchaseId);
    const merchant = purchase.merchant.toLowerCase() === runtime.alternateMerchant.address.toLowerCase()
      ? runtime.alternateMerchant
      : runtime.merchant;
    const before = await balances(runtime);
    const tx = await runtime.vault.connect(merchant).settlePurchase(purchaseId);
    const receipt = await tx.wait();
    const after = await balances(runtime);
    runtime.selectedPurchase.status = "Settled";
    runtime.search.status = "settled";
    const report = runtime.reports.find((entry) => entry.id === runtime.selectedPurchase.reportId);
    if (report) {
      report.status = "settled";
      report.title = "Order filled and mock payment captured";
      report.summary = `${runtime.selectedPurchase.merchant} verified the current mandate and captured US$${runtime.selectedPurchase.selected.amount} from the mock payment method.`;
      report.settlement = {
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber.toString(),
        amount: runtime.selectedPurchase.selected.amount,
        balances: Object.fromEntries(Object.keys(before).map((name) => [name, balanceMovement(before[name], after[name])])),
      };
      report.updatedAt = nowIso();
    }
    this.audit.push({
      type: "merchant_captured_mock_payment",
      detail: `${runtime.selectedPurchase.merchant} filled ${runtime.selectedPurchase.orderReference} after verification and received the mock USD payment.`,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
    });
    runtime.conversation.push({ role: "assistant", content: `Order filled. ${runtime.selectedPurchase.merchant} captured US$${runtime.selectedPurchase.selected.amount} only after on-chain verification passed. Your record and the merchant/auditor trail are below.` });
    return { purchaseId, transactionHash: tx.hash, state: await this.state() };
  }

  async amendPriceCap(maxUnitPrice) {
    const runtime = await this.ensure();
    if (runtime.activeMandateId === null) throw new Error("Sign a mandate before amending its fare cap.");
    const cap = parseUsd(maxUnitPrice, "Per-ticket cap");
    const originalBudget = parseUsd(runtime.draft.budget, "Budget");
    if (cap * BigInt(runtime.draft.quantity) > originalBudget) {
      throw new Error("The live per-ticket cap cannot exceed the signed total budget for all tickets.");
    }
    const tx = await runtime.vault.connect(runtime.owner).amendMaxUnitPrice(runtime.activeMandateId, cap);
    const receipt = await tx.wait();
    runtime.draft = { ...runtime.draft, maxUnitPrice: displayUsd(cap), updatedAt: nowIso() };
    this.audit.push({
      type: "flight_fare_cap_amended",
      detail: `Buyer changed the live per-ticket cap to US$${displayUsd(cap)}. Any unused old authorization now fails verification.`,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
    });
    return this.state();
  }

  async revokeMandate() {
    const runtime = await this.ensure();
    if (runtime.activeMandateId === null) throw new Error("There is no active mandate to revoke.");
    const tx = await runtime.vault.connect(runtime.owner).revokeMandate(runtime.activeMandateId);
    const receipt = await tx.wait();
    runtime.draft = { ...runtime.draft, status: "revoked", updatedAt: nowIso() };
    this.audit.push({
      type: "flight_mandate_revoked",
      detail: `Buyer revoked mandate ${runtime.activeMandateId}. Every later authorization and unused capture must fail.`,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
    });
    runtime.conversation.push({ role: "assistant", content: "Mandate revoked on-chain. I cannot authorize another flight, and an unused authorization can no longer be captured." });
    return this.state();
  }

  async attemptOutsideMandate() {
    const runtime = await this.ensure();
    if (runtime.activeMandateId === null || runtime.draft?.status !== "signed") throw new Error("Sign an active mandate before running the out-of-limit trial.");
    const max = Number(runtime.draft.maxUnitPrice);
    const unitPrice = parseUsd((max + 150).toFixed(2), "Trial fare");
    const latest = await runtime.provider.getBlock("latest");
    const merchant = runtime.merchant;
    const orderId = ethers.id(`OUTSIDE-LIMIT-${Date.now()}`);
    const expiresAt = Number(latest.timestamp) + 300;
    const checkoutHash = await runtime.vault.marketplaceCheckoutHashFor(runtime.activeMandateId, merchant.address, orderId, expiresAt, BigInt(runtime.draft.quantity), unitPrice);
    const signature = await merchant.signMessage(ethers.getBytes(checkoutHash));
    let reason = "";
    try {
      await runtime.vault.connect(runtime.agent).reserveMarketplacePurchase(
        runtime.activeMandateId, merchant.address, orderId, expiresAt, BigInt(runtime.draft.quantity), unitPrice, signature,
      );
      throw new Error("The outside-mandate purchase was unexpectedly authorized.");
    } catch (error) {
      reason = errorMessage(error);
      if (/unexpectedly authorized/i.test(reason)) throw error;
    }
    this.recordTrial(
      runtime,
      { type: "outside_mandate", rejected: true, reason, attemptedUnitPrice: displayUsd(unitPrice), at: nowIso() },
      "outside_mandate_purchase_rejected",
      `A US$${displayUsd(unitPrice)} per-ticket flight was rejected before authorization: ${reason}`,
    );
    return { ...runtime.trial, state: await this.state() };
  }

  async attemptImpersonatedAgent() {
    const runtime = await this.ensure();
    if (runtime.activeMandateId === null || runtime.draft?.status !== "signed") throw new Error("Sign an active mandate before running the impersonation trial.");
    const candidate = this.eligibleTrialCandidate(runtime);
    const merchant = merchantFor(runtime, candidate.merchant);
    const latest = await runtime.provider.getBlock("latest");
    const orderId = ethers.id(`IMPOSTER-${candidate.quoteId}-${Date.now()}`);
    const checkoutExpiresAt = Number(latest.timestamp) + 300;
    const unitPrice = parseUsd(candidate.unitPrice, "Flight fare");
    const checkoutHash = await runtime.vault.marketplaceCheckoutHashFor(
      runtime.activeMandateId, merchant.address, orderId, checkoutExpiresAt, BigInt(runtime.draft.quantity), unitPrice,
    );
    const signature = await merchant.signMessage(ethers.getBytes(checkoutHash));
    let reason = "";
    try {
      await runtime.vault.connect(runtime.imposter).reserveMarketplacePurchase(
        runtime.activeMandateId, merchant.address, orderId, checkoutExpiresAt, BigInt(runtime.draft.quantity), unitPrice, signature,
      );
      throw new Error("The impersonated-agent purchase was unexpectedly authorized.");
    } catch (error) {
      reason = errorMessage(error);
      if (/unexpectedly authorized/i.test(reason)) throw error;
    }
    this.recordTrial(
      runtime,
      { type: "impersonated_agent", rejected: true, reason, quoteId: candidate.quoteId, at: nowIso() },
      "impersonated_agent_purchase_rejected",
      `A non-delegated wallet tried to use a valid ${candidate.quoteId} merchant quote and was rejected: ${reason}`,
    );
    return { ...runtime.trial, state: await this.state() };
  }

  async attemptExpiredMandate() {
    const runtime = await this.ensure();
    if (runtime.activeMandateId === null || runtime.draft?.status !== "signed") throw new Error("Sign an active mandate before running the expiry trial.");
    const mandate = await runtime.vault.mandates(runtime.activeMandateId);
    const latest = await runtime.provider.getBlock("latest");
    const secondsToExpiry = Number(mandate.expiresAt) - Number(latest.timestamp) + 1;
    if (secondsToExpiry > 0) {
      await runtime.provider.send("evm_increaseTime", [secondsToExpiry]);
      await runtime.provider.send("evm_mine", []);
    }
    const candidate = this.eligibleTrialCandidate(runtime);
    const merchant = merchantFor(runtime, candidate.merchant);
    const expiredAt = await runtime.provider.getBlock("latest");
    const orderId = ethers.id(`EXPIRED-${candidate.quoteId}-${Date.now()}`);
    const checkoutExpiresAt = Number(expiredAt.timestamp) + 300;
    const unitPrice = parseUsd(candidate.unitPrice, "Flight fare");
    const checkoutHash = await runtime.vault.marketplaceCheckoutHashFor(
      runtime.activeMandateId, merchant.address, orderId, checkoutExpiresAt, BigInt(runtime.draft.quantity), unitPrice,
    );
    const signature = await merchant.signMessage(ethers.getBytes(checkoutHash));
    let reason = "";
    try {
      await runtime.vault.connect(runtime.agent).reserveMarketplacePurchase(
        runtime.activeMandateId, merchant.address, orderId, checkoutExpiresAt, BigInt(runtime.draft.quantity), unitPrice, signature,
      );
      throw new Error("The expired-mandate purchase was unexpectedly authorized.");
    } catch (error) {
      reason = errorMessage(error);
      if (/unexpectedly authorized/i.test(reason)) throw error;
    }
    runtime.draft = { ...runtime.draft, status: "expired", updatedAt: nowIso() };
    this.recordTrial(
      runtime,
      { type: "expired_mandate", rejected: true, reason, quoteId: candidate.quoteId, at: nowIso() },
      "expired_mandate_purchase_rejected",
      `The local clock moved past the buyer-approved mandate expiry and ${candidate.quoteId} was rejected: ${reason}`,
    );
    runtime.conversation.push({ role: "assistant", content: "The local demo clock is past the mandate validity date. I refused the new purchase attempt and no mock USD moved." });
    return { ...runtime.trial, state: await this.state() };
  }

  async attemptAfterRevocation() {
    const runtime = await this.ensure();
    if (runtime.activeMandateId === null) throw new Error("There is no mandate to test.");
    const mandate = await runtime.vault.mandates(runtime.activeMandateId);
    if (Number(mandate.status) !== 2) throw new Error("Revoke the mandate first, then run this trial.");
    const candidate = this.eligibleTrialCandidate(runtime);
    const merchant = merchantFor(runtime, candidate.merchant);
    const latest = await runtime.provider.getBlock("latest");
    const orderId = ethers.id(`REVOKED-${candidate.quoteId}-${Date.now()}`);
    const expiresAt = Number(latest.timestamp) + 300;
    const unitPrice = parseUsd(candidate.unitPrice, "Flight fare");
    const checkoutHash = await runtime.vault.marketplaceCheckoutHashFor(runtime.activeMandateId, merchant.address, orderId, expiresAt, BigInt(runtime.draft.quantity), unitPrice);
    const signature = await merchant.signMessage(ethers.getBytes(checkoutHash));
    let reason = "";
    try {
      await runtime.vault.connect(runtime.agent).reserveMarketplacePurchase(
        runtime.activeMandateId, merchant.address, orderId, expiresAt, BigInt(runtime.draft.quantity), unitPrice, signature,
      );
      throw new Error("The revoked-mandate purchase was unexpectedly authorized.");
    } catch (error) {
      reason = errorMessage(error);
      if (/unexpectedly authorized/i.test(reason)) throw error;
    }
    this.recordTrial(
      runtime,
      { type: "revoked_mandate", rejected: true, reason, quoteId: candidate.quoteId, at: nowIso() },
      "revoked_mandate_purchase_rejected",
      `A valid-looking ${candidate.quoteId} checkout was rejected because the mandate was revoked: ${reason}`,
    );
    return { ...runtime.trial, state: await this.state() };
  }

  async state() {
    const runtime = await this.ensure();
    const latest = await runtime.provider.getBlock("latest");
    const visibleMandateId = runtime.activeMandateId ?? runtime.lastMandateId;
    const mandate = visibleMandateId === null ? null : await runtime.vault.mandates(visibleMandateId);
    const mandateActive = visibleMandateId === null ? false : await runtime.vault.isMandateActive(visibleMandateId);
    const mandateStatus = !mandate ? null : Number(mandate.status) === 2
      ? "Revoked"
      : mandateActive
        ? "Active"
        : "Expired";
    const sellerBalances = await balances(runtime);
    return {
      network: { name: "CHK local chain (Ganache)", chainId: (await runtime.provider.getNetwork()).chainId.toString(), latestBlock: latest.number.toString() },
      contracts: { mandateVault: runtime.vault.target, cardProcessor: runtime.processor.target, mockUsd: runtime.usd.target },
      buyer: { ...runtime.buyer, wallet: runtime.owner.address },
      kyc: {
        status: runtime.paymentMethodEnrolled ? "Verified - opaque payment token enrolled" : "KYC required",
        paymentMethodId: runtime.paymentMethodEnrolled ? runtime.paymentMethodId : null,
        credentialHash: runtime.paymentMethodEnrolled ? runtime.kycCredentialHash : null,
        captureReady: runtime.paymentMethodEnrolled,
      },
      mandate: mandate ? {
        id: visibleMandateId.toString(),
        status: mandateStatus,
        active: mandateActive,
        productHash: mandate.productHash,
        maxUnitPrice: displayUsd(mandate.maxUnitPrice),
        remainingTickets: mandate.remainingQuantity.toString(),
        remainingBudget: displayUsd(mandate.remainingBudget),
        expiresAt: new Date(Number(mandate.expiresAt) * 1000).toISOString(),
        revision: mandate.revision.toString(),
      } : null,
      balances: sellerBalances,
      flight: {
        draft: runtime.draft,
        signedMandate: runtime.signedMandate,
        archivedSignedMandate: runtime.archivedSignedMandate,
        activeMandateId: runtime.activeMandateId?.toString() ?? null,
        search: runtime.search,
        suggestion: runtime.suggestion,
        clarification: runtime.clarification,
        selection: runtime.selectedPurchase,
        reports: runtime.reports,
        lastReport: runtime.reports.find((report) => report.id === runtime.lastReportId) ?? null,
        conversation: runtime.conversation,
        trial: runtime.trial,
        trials: runtime.trials,
        merchants: flightMerchants.map((name) => ({ name, wallet: merchantFor(runtime, name).address, balance: sellerBalances[name] })),
      },
      audit: this.audit,
    };
  }
}

export { errorMessage };
