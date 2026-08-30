import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import { ethers } from "ethers";
import solc from "solc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(__dirname, "..");
const USD_DECIMALS = 6;
const paymentMethodId = ethers.id("demo-tokenized-business-card");
const kycCredentialHash = ethers.id("demo-kyc-marta-verified-business-account");

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

async function readLatestBlock(provider) {
  const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
  return {
    number: Number(block.number),
    timestamp: Number(block.timestamp),
  };
}

async function sendWithNonceRecovery(signer, send) {
  try {
    return await send();
  } catch (error) {
    // NonceManager advances before some estimate/broadcast failures. Resetting
    // here lets the next policy-compliant action reuse the real pending nonce.
    signer.reset();
    throw error;
  }
}

function errorMessage(error) {
  return error?.info?.error?.message || error?.shortMessage || error?.message || "Transaction failed";
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
    const [owner, agent, merchant] = wallets;
    const usd = await deploy(owner, "contracts/MockUSD.sol", "MockUSD");
    const processor = await deploy(owner, "contracts/MockCardProcessor.sol", "MockCardProcessor", [usd.target]);
    const vault = await deploy(owner, "contracts/MandateVault.sol", "MandateVault", [processor.target]);

    const setVaultTx = await sendWithNonceRecovery(owner, () => processor.setVault(vault.target));
    await setVaultTx.wait();
    await (await sendWithNonceRecovery(owner, () => usd.mint(owner.address, parseUsd("2000", "seed balance")))).wait();

    this.runtime = {
      provider,
      owner,
      agent,
      merchant,
      usd,
      processor,
      vault,
      productHash: ethers.id(options.product ?? "flight-cordoba"),
      mandateOptions: { quantity, maxUnitPrice, budget },
      paymentMethodEnrolled: false,
      mandateCreated: false,
    };
    this.audit = [{
      type: "local_payment_stack_deployed",
      detail: "Local chain, mandate registry, credential provider, and mock bank account are ready.",
      transactionHash: vault.deploymentTransaction().hash,
      blockNumber: (await vault.deploymentTransaction().wait()).blockNumber,
    }];
    return this.state();
  }

  async loginAndEnrollBuyer() {
    const runtime = await this.ensure();
    if (runtime.paymentMethodEnrolled) throw new Error("Buyer KYC/login and payment enrollment are already complete.");

    const enrollmentTx = await sendWithNonceRecovery(runtime.owner, () => (
      runtime.processor.connect(runtime.owner).registerVerifiedPaymentMethod(
        paymentMethodId,
        runtime.owner.address,
        kycCredentialHash,
      )
    ));
    const enrollmentReceipt = await enrollmentTx.wait();
    const consentTx = await sendWithNonceRecovery(runtime.owner, () => (
      runtime.usd.connect(runtime.owner).approve(runtime.processor.target, ethers.MaxUint256)
    ));
    const consentReceipt = await consentTx.wait();
    runtime.paymentMethodEnrolled = true;
    this.audit.push({
      type: "kyc_login_payment_enrolled",
      detail: "Marta's verified login is linked to an opaque payment token. No card number or funds are on-chain.",
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

    const latestBlock = await readLatestBlock(runtime.provider);
    const createMandateTx = await sendWithNonceRecovery(runtime.owner, () => (
      runtime.vault.connect(runtime.owner).createMandate(
        runtime.agent.address,
        runtime.merchant.address,
        paymentMethodId,
        runtime.productHash,
        quantity,
        maxUnitPrice,
        budget,
        Number(latestBlock.timestamp) + 30 * 24 * 60 * 60,
      )
    ));
    const createMandateReceipt = await createMandateTx.wait();
    runtime.mandateCreated = true;
    this.audit.push({
      type: "mandate_signed",
      detail: "Buyer signed a revocable purchase mandate using the KYC-linked payment token; no funds were pre-funded.",
      transactionHash: createMandateTx.hash,
      blockNumber: createMandateReceipt.blockNumber,
    });
    return this.state();
  }

  async ensure() {
    if (this.runtime === null) await this.reset();
    return this.runtime;
  }

  async state() {
    const runtime = await this.ensure();
    const latestBlock = await readLatestBlock(runtime.provider);
    const mandate = runtime.mandateCreated ? await runtime.vault.mandates(1) : null;
    const mandateIsActive = mandate ? await runtime.vault.isMandateActive(1) : false;
    const storedMandateStatus = mandate ? ["None", "Active", "Revoked"][Number(mandate.status)] : null;
    return {
      network: {
        name: "CHK local chain (Ganache)",
        chainId: (await runtime.provider.getNetwork()).chainId.toString(),
        latestBlock: latestBlock.number.toString(),
      },
      contracts: { vault: runtime.vault.target, cardProcessor: runtime.processor.target, mockUsd: runtime.usd.target },
      identities: { owner: runtime.owner.address, agent: runtime.agent.address, merchant: runtime.merchant.address },
      kyc: {
        status: runtime.paymentMethodEnrolled ? "Verified and payment-token enrolled" : "Login required",
        paymentMethodId: runtime.paymentMethodEnrolled ? paymentMethodId : null,
        credentialHash: runtime.paymentMethodEnrolled ? kycCredentialHash : null,
        captureReady: runtime.paymentMethodEnrolled,
      },
      mandate: mandate ? {
        id: "1",
        status: storedMandateStatus === "Revoked" ? "Revoked" : mandateIsActive ? "Active" : "Expired",
        productHash: runtime.productHash,
        kycCredentialHash: mandate.kycCredentialHash,
        maxUnitPrice: displayUsd(mandate.maxUnitPrice),
        remainingQuantity: mandate.remainingQuantity.toString(),
        remainingBudget: displayUsd(mandate.remainingBudget),
        expiresAt: new Date(Number(mandate.expiresAt) * 1000).toISOString(),
        revision: mandate.revision.toString(),
      } : null,
      balances: {
        buyer: displayUsd(await runtime.usd.balanceOf(runtime.owner.address)),
        cardProcessor: displayUsd(await runtime.usd.balanceOf(runtime.processor.target)),
        merchant: displayUsd(await runtime.usd.balanceOf(runtime.merchant.address)),
      },
      audit: this.audit,
    };
  }

  async reservePurchase({ orderReference, quantity = 1, unitPrice }) {
    const runtime = await this.ensure();
    if (!runtime.mandateCreated) throw new Error("A signed mandate is required before the agent can purchase.");
    const reference = orderReference || `offer-${Date.now()}`;
    const orderId = ethers.id(reference);
    const quotedAt = await readLatestBlock(runtime.provider);
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
    let tx;
    try {
      tx = await sendWithNonceRecovery(runtime.agent, () => (
        runtime.vault.connect(runtime.agent).reservePurchase(
          1,
          orderId,
          checkoutExpiresAt,
          parsedQuantity,
          parsedUnitPrice,
          merchantSignature,
        )
      ));
    } catch (error) {
      const mandate = await runtime.vault.mandates(1);
      const active = await runtime.vault.isMandateActive(1);
      const amount = parsedQuantity * parsedUnitPrice;
      let reason = errorMessage(error);

      if (!active) {
        reason = "MANDATE_INACTIVE: the mandate is revoked or expired.";
      } else if (parsedQuantity > mandate.remainingQuantity) {
        reason = "QUANTITY_EXCEEDED: the purchase exceeds the remaining authorized quantity.";
      } else if (parsedUnitPrice > mandate.maxUnitPrice) {
        reason = `PRICE_EXCEEDED: US$${displayUsd(parsedUnitPrice)} exceeds the US$${displayUsd(mandate.maxUnitPrice)} unit limit.`;
      } else if (amount > mandate.remainingBudget) {
        reason = "BUDGET_EXCEEDED: the purchase exceeds the remaining mandate budget.";
      }

      const latestBlock = await readLatestBlock(runtime.provider);
      this.audit.push({
        type: "agent_purchase_rejected",
        outcome: "rejected",
        orderReference: reference,
        quantity: parsedQuantity.toString(),
        unitPrice: displayUsd(parsedUnitPrice),
        maxUnitPrice: displayUsd(mandate.maxUnitPrice),
        detail: reason,
        transactionHash: null,
        blockNumber: latestBlock.number,
      });
      throw new Error(reason);
    }
    let receipt;
    try {
      receipt = await tx.wait();
    } catch (error) {
      const purchase = await runtime.vault.purchases(purchaseId);
      if (Number(purchase.status) === 0) throw error;
      receipt = { blockNumber: (await readLatestBlock(runtime.provider)).number };
    }
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

  async verifyPurchase(purchaseId, options = {}) {
    const runtime = await this.ensure();
    const purchase = await runtime.vault.purchases(purchaseId);
    const mandate = await runtime.vault.mandates(purchase.mandateId);
    const virtualCard = await runtime.processor.virtualCards(purchaseId);
    const active = await runtime.vault.isMandateActive(purchase.mandateId);
    const latestBlock = await readLatestBlock(runtime.provider);
    const computedCheckoutHash = Number(purchase.status) === 0
      ? ethers.ZeroHash
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
      merchantMatches: mandate.merchant.toLowerCase() === runtime.merchant.address.toLowerCase(),
      kycPaymentMethodBound: await runtime.processor.isVerifiedPaymentMethod(mandate.owner, mandate.paymentMethodId),
      buyerCredentialMatches: mandate.kycCredentialHash === kycCredentialHash,
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
        mandateRevision: purchase.mandateRevision.toString(),
        checkoutHash: purchase.checkoutHash,
        checkoutExpiresAt: new Date(Number(purchase.checkoutExpiresAt) * 1000).toISOString(),
      },
      mandateRevision: mandate.revision.toString(),
    };
    if (options.recordAudit !== false) {
      this.audit.push({
        type: result.verified ? "merchant_verification_passed" : "merchant_verification_failed",
        outcome: result.verified ? "verified" : "rejected",
        context: options.context || "merchant_review",
        purchaseId,
        mandateRevision: result.mandateRevision,
        checks,
        failedChecks: Object.entries(checks).filter(([, passed]) => !passed).map(([check]) => check),
        detail: result.verified
          ? "VuelaYa verified every mandate, identity, checkout, and one-use authorization check against live state."
          : "VuelaYa rejected the purchase after one or more live mandate checks failed.",
        transactionHash: null,
        blockNumber: latestBlock.number,
      });
    }
    return result;
  }

  async capturePurchase(purchaseId) {
    const runtime = await this.ensure();
    const verification = await this.verifyPurchase(purchaseId, { context: "capture_revalidation" });
    if (!verification.verified) throw new Error("Merchant verification failed; capture was not attempted.");
    const tx = await sendWithNonceRecovery(runtime.merchant, () => (
      runtime.vault.connect(runtime.merchant).settlePurchase(purchaseId)
    ));
    const receipt = await tx.wait();
    this.audit.push({
      type: "merchant_captured_purchase",
      purchaseId,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
    return { purchaseId, transactionHash: tx.hash, state: await this.state() };
  }

  async amendPriceCap(maxUnitPrice) {
    const runtime = await this.ensure();
    const tx = await sendWithNonceRecovery(runtime.owner, () => (
      runtime.vault.connect(runtime.owner).amendMaxUnitPrice(1, parseUsd(maxUnitPrice, "maxUnitPrice"))
    ));
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
    const tx = await sendWithNonceRecovery(runtime.owner, () => runtime.vault.connect(runtime.owner).revokeMandate(1));
    const receipt = await tx.wait();
    this.audit.push({ type: "mandate_revoked", transactionHash: tx.hash, blockNumber: receipt.blockNumber });
    return this.state();
  }

  async releasePurchase(purchaseId, releasedBy = "buyer") {
    const runtime = await this.ensure();
    const signer = releasedBy === "agent" ? runtime.agent : runtime.owner;
    const tx = await sendWithNonceRecovery(signer, () => runtime.vault.connect(signer).releasePurchase(purchaseId));
    const receipt = await tx.wait();
    this.audit.push({
      type: "unused_authorization_released",
      purchaseId,
      releasedBy: releasedBy === "agent" ? "agent" : "buyer",
      releasedByAddress: signer.address,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
    return this.state();
  }
}

export { errorMessage };
