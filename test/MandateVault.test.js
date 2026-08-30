import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ganache from "ganache";
import { ethers } from "ethers";
import solc from "solc";

const USD_DECIMALS = 6;
const usd = (value) => ethers.parseUnits(value, USD_DECIMALS);
const productHash = ethers.id("arabica-coffee-beans-100kg");
const paymentMethodId = ethers.id("buyer-business-card-token");
const kycCredentialHash = ethers.id("kyc-buyer-verified-business-account");

function compileContracts() {
  const files = [
    "contracts/interfaces/IERC20.sol",
    "contracts/interfaces/IMockCardProcessor.sol",
    "contracts/MockUSD.sol",
    "contracts/MockCardProcessor.sol",
    "contracts/MandateVault.sol",
  ];
  const sources = Object.fromEntries(
    files.map((file) => [file, { content: fs.readFileSync(path.join(process.cwd(), file), "utf8") }]),
  );
  const result = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources,
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  })));
  const errors = (result.errors || []).filter((error) => error.severity === "error");
  assert.equal(errors.length, 0, errors.map((error) => error.formattedMessage).join("\n"));
  return result.contracts;
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

async function setup({ buyerBalance = "2000" } = {}) {
  const ganacheProvider = ganache.provider({ logging: { quiet: true } });
  const provider = new ethers.BrowserProvider(ganacheProvider);
  const wallets = Object.values(ganacheProvider.getInitialAccounts()).map(({ secretKey }) => {
    const wallet = new ethers.Wallet(secretKey, provider);
    const signer = new ethers.NonceManager(wallet);
    signer.address = wallet.address;
    return signer;
  });
  const [owner, agent, seller, outsider] = wallets;
  const usdToken = await deploy(owner, "contracts/MockUSD.sol", "MockUSD");
  const cardProcessor = await deploy(owner, "contracts/MockCardProcessor.sol", "MockCardProcessor", [usdToken.target]);
  const vault = await deploy(owner, "contracts/MandateVault.sol", "MandateVault", [cardProcessor.target]);
  await (await cardProcessor.connect(owner).setVault(vault.target)).wait();

  await (await usdToken.mint(owner.address, usd(buyerBalance))).wait();
  await (
    await cardProcessor.connect(owner).registerVerifiedPaymentMethod(
      paymentMethodId,
      owner.address,
      kycCredentialHash,
    )
  ).wait();
  await (await usdToken.connect(owner).approve(cardProcessor.target, ethers.MaxUint256)).wait();

  const now = Number((await provider.getBlock("latest")).timestamp);
  await (
    await vault.connect(owner).createMandate(
      agent.address,
      seller.address,
      paymentMethodId,
      productHash,
      100,
      usd("12"),
      usd("1200"),
      now + 86_400,
    )
  ).wait();

  return { provider, owner, agent, seller, outsider, usdToken, cardProcessor, vault };
}

async function merchantQuote({ provider, vault, seller, orderReference, quantity, unitPrice }) {
  const orderId = ethers.id(orderReference);
  const block = await provider.getBlock("latest");
  const checkoutExpiresAt = Number(block.timestamp) + 300;
  const checkoutHash = await vault.checkoutHashFor(1, orderId, checkoutExpiresAt, quantity, unitPrice);
  const signature = await seller.signMessage(ethers.getBytes(checkoutHash));
  const purchaseId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [1, checkoutHash]),
  );
  return { orderId, checkoutExpiresAt, checkoutHash, signature, purchaseId };
}

async function reserve(context, { orderReference, quantity, unitPrice }) {
  const quote = await merchantQuote({
    provider: context.provider,
    vault: context.vault,
    seller: context.seller,
    orderReference,
    quantity,
    unitPrice,
  });
  await (
    await context.vault.connect(context.agent).reservePurchase(
      1,
      quote.orderId,
      quote.checkoutExpiresAt,
      quantity,
      unitPrice,
      quote.signature,
    )
  ).wait();
  return quote;
}

test("creating a mandate requires a KYC-linked payment token and does not pre-fund it", async () => {
  const { owner, cardProcessor, usdToken, vault } = await setup();
  assert.equal(await cardProcessor.isVerifiedPaymentMethod(owner.address, paymentMethodId), true);
  assert.equal(await usdToken.balanceOf(owner.address), usd("2000"));
  assert.equal(await usdToken.balanceOf(cardProcessor.target), 0n);
  assert.equal((await vault.mandates(1)).kycCredentialHash, kycCredentialHash);
});

test("an agent binds a merchant-signed checkout without moving money; capture debits and pays atomically", async () => {
  const context = await setup();
  const { owner, seller, usdToken, cardProcessor, vault } = context;
  const quote = await reserve(context, { orderReference: "seller-order-001", quantity: 25, unitPrice: usd("10") });

  const virtualCard = await cardProcessor.virtualCards(quote.purchaseId);
  const purchase = await vault.purchases(quote.purchaseId);
  assert.equal(purchase.status, 1n);
  assert.equal(purchase.checkoutHash, quote.checkoutHash);
  assert.equal(virtualCard.status, 1n);
  assert.equal(await usdToken.balanceOf(owner.address), usd("2000"), "authorization must not debit the buyer");
  assert.equal(await usdToken.balanceOf(cardProcessor.target), 0n, "processor holds no buyer float");
  assert.equal(await usdToken.balanceOf(seller.address), 0n);

  await (await vault.connect(seller).settlePurchase(quote.purchaseId)).wait();

  const mandate = await vault.mandates(1);
  assert.equal((await vault.purchases(quote.purchaseId)).status, 2n);
  assert.equal((await cardProcessor.virtualCards(quote.purchaseId)).status, 2n);
  assert.equal(await usdToken.balanceOf(owner.address), usd("1750"));
  assert.equal(await usdToken.balanceOf(seller.address), usd("250"));
  assert.equal(await usdToken.balanceOf(cardProcessor.target), 0n);
  assert.equal(mandate.remainingQuantity, 75n);
  assert.equal(mandate.remainingBudget, usd("950"));
});

test("only the delegated agent can bind a valid merchant checkout and static limits remain enforced", async () => {
  const context = await setup();
  const { agent, owner, outsider, vault } = context;
  const valid = await merchantQuote({
    provider: context.provider,
    vault,
    seller: context.seller,
    orderReference: "valid-order",
    quantity: 1,
    unitPrice: usd("10"),
  });

  await assert.rejects(vault.connect(owner).reservePurchase.staticCall(1, valid.orderId, valid.checkoutExpiresAt, 1, usd("10"), valid.signature));
  await assert.rejects(vault.connect(outsider).reservePurchase.staticCall(1, valid.orderId, valid.checkoutExpiresAt, 1, usd("10"), valid.signature));

  const expensive = await merchantQuote({
    provider: context.provider, vault, seller: context.seller, orderReference: "too-expensive", quantity: 1, unitPrice: usd("13"),
  });
  await assert.rejects(vault.connect(agent).reservePurchase.staticCall(1, expensive.orderId, expensive.checkoutExpiresAt, 1, usd("13"), expensive.signature));

  const tooMany = await merchantQuote({
    provider: context.provider, vault, seller: context.seller, orderReference: "too-many-units", quantity: 101, unitPrice: usd("10"),
  });
  await assert.rejects(vault.connect(agent).reservePurchase.staticCall(1, tooMany.orderId, tooMany.checkoutExpiresAt, 101, usd("10"), tooMany.signature));
});

test("a forged merchant quote is rejected even when the agent is legitimate", async () => {
  const context = await setup();
  const { provider, vault, agent, outsider } = context;
  const orderId = ethers.id("forged-merchant-order");
  const block = await provider.getBlock("latest");
  const checkoutExpiresAt = Number(block.timestamp) + 300;
  const checkoutHash = await vault.checkoutHashFor(1, orderId, checkoutExpiresAt, 1, usd("10"));
  const forgedSignature = await outsider.signMessage(ethers.getBytes(checkoutHash));

  await assert.rejects(vault.connect(agent).reservePurchase.staticCall(1, orderId, checkoutExpiresAt, 1, usd("10"), forgedSignature));
});

test("a declined capture sends no money and leaves the authorization available for release", async () => {
  const context = await setup({ buyerBalance: "100" });
  const { owner, seller, usdToken, cardProcessor, vault } = context;
  const quote = await reserve(context, { orderReference: "insufficient-balance", quantity: 25, unitPrice: usd("10") });

  await assert.rejects(vault.connect(seller).settlePurchase.staticCall(quote.purchaseId));
  assert.equal((await vault.purchases(quote.purchaseId)).status, 1n);
  assert.equal((await cardProcessor.virtualCards(quote.purchaseId)).status, 1n);
  assert.equal(await usdToken.balanceOf(owner.address), usd("100"));
  assert.equal(await usdToken.balanceOf(seller.address), 0n);

  await (await vault.connect(owner).releasePurchase(quote.purchaseId)).wait();
  const mandate = await vault.mandates(1);
  assert.equal((await vault.purchases(quote.purchaseId)).status, 3n);
  assert.equal((await cardProcessor.virtualCards(quote.purchaseId)).status, 3n);
  assert.equal(mandate.remainingQuantity, 100n);
  assert.equal(mandate.remainingBudget, usd("1200"));
});

test("revocation blocks capture of an unused authorization; releasing it moves no money", async () => {
  const context = await setup();
  const { owner, seller, usdToken, cardProcessor, vault } = context;
  const quote = await reserve(context, { orderReference: "seller-order-pending", quantity: 10, unitPrice: usd("10") });
  await (await vault.connect(owner).revokeMandate(1)).wait();

  await assert.rejects(vault.connect(seller).settlePurchase.staticCall(quote.purchaseId));
  await (await vault.connect(owner).releasePurchase(quote.purchaseId)).wait();
  assert.equal((await vault.purchases(quote.purchaseId)).status, 3n);
  assert.equal((await cardProcessor.virtualCards(quote.purchaseId)).status, 3n);
  assert.equal(await usdToken.balanceOf(owner.address), usd("2000"));
});

test("a live price-cap amendment invalidates an old authorization and governs the next signed checkout", async () => {
  const context = await setup();
  const { owner, seller, cardProcessor, vault } = context;
  const oldQuote = await reserve(context, { orderReference: "offer-at-12", quantity: 1, unitPrice: usd("12") });
  await (await vault.connect(owner).amendMaxUnitPrice(1, usd("11"))).wait();

  assert.equal((await vault.mandates(1)).revision, 2n);
  await assert.rejects(vault.connect(seller).settlePurchase.staticCall(oldQuote.purchaseId));
  await (await vault.connect(owner).releasePurchase(oldQuote.purchaseId)).wait();
  assert.equal((await cardProcessor.virtualCards(oldQuote.purchaseId)).status, 3n);

  const tooExpensive = await merchantQuote({
    provider: context.provider, vault, seller, orderReference: "offer-at-12-retry", quantity: 1, unitPrice: usd("12"),
  });
  await assert.rejects(vault.connect(context.agent).reservePurchase.staticCall(1, tooExpensive.orderId, tooExpensive.checkoutExpiresAt, 1, usd("12"), tooExpensive.signature));

  const validQuote = await reserve(context, { orderReference: "offer-at-10", quantity: 1, unitPrice: usd("10") });
  await (await vault.connect(seller).settlePurchase(validQuote.purchaseId)).wait();
  assert.equal(await context.usdToken.balanceOf(seller.address), usd("10"));
});
