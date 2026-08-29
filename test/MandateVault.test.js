const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ganache = require("ganache");
const { ethers } = require("ethers");
const solc = require("solc");

const USD_DECIMALS = 6;
const usd = (value) => ethers.parseUnits(value, USD_DECIMALS);
const productHash = ethers.id("arabica-coffee-beans-100kg");
const paymentMethodId = ethers.id("buyer-business-card-token");

function compileContracts() {
  const files = [
    "contracts/interfaces/IERC20.sol",
    "contracts/interfaces/IMockCardProcessor.sol",
    "contracts/MockUSD.sol",
    "contracts/MockCardProcessor.sol",
    "contracts/MandateVault.sol"
  ];
  const sources = Object.fromEntries(
    files.map((file) => [file, { content: fs.readFileSync(path.join(process.cwd(), file), "utf8") }])
  );
  const result = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources,
        settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } }
      })
    )
  );
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
  const provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true } }));
  const owner = await provider.getSigner(0);
  const agent = await provider.getSigner(1);
  const seller = await provider.getSigner(2);
  const outsider = await provider.getSigner(3);
  const usdToken = await deploy(owner, "contracts/MockUSD.sol", "MockUSD");
  const cardProcessor = await deploy(owner, "contracts/MockCardProcessor.sol", "MockCardProcessor", [usdToken.target]);
  const vault = await deploy(owner, "contracts/MandateVault.sol", "MandateVault", [cardProcessor.target]);
  await (await cardProcessor.connect(owner).setVault(vault.target)).wait();

  await (await usdToken.mint(owner.address, usd(buyerBalance))).wait();
  await (await cardProcessor.connect(owner).registerPaymentMethod(paymentMethodId)).wait();
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
      now + 86_400
    )
  ).wait();

  return { owner, agent, seller, outsider, usdToken, cardProcessor, vault };
}

function purchaseId(mandateId, orderId) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [mandateId, orderId]));
}

test("creating a mandate does not pre-fund it", async () => {
  const { owner, usdToken, cardProcessor } = await setup();
  assert.equal(await usdToken.balanceOf(owner.address), usd("2000"));
  assert.equal(await usdToken.balanceOf(cardProcessor.target), 0n);
});

test("agent charge creates a one-use virtual card; seller capture executes the USD payment", async () => {
  const { owner, agent, seller, usdToken, cardProcessor, vault } = await setup();
  const orderId = ethers.id("seller-order-001");
  const id = purchaseId(1, orderId);

  await (await vault.connect(agent).reservePurchase(1, orderId, 25, usd("10"))).wait();

  const virtualCard = await cardProcessor.virtualCards(id);
  assert.equal((await vault.purchases(id)).status, 1n);
  assert.equal(virtualCard.status, 1n);
  assert.equal(await usdToken.balanceOf(owner.address), usd("1750"));
  assert.equal(await usdToken.balanceOf(cardProcessor.target), usd("250"));
  assert.equal(await usdToken.balanceOf(seller.address), 0n);

  await (await vault.connect(seller).settlePurchase(id)).wait();

  const mandate = await vault.mandates(1);
  assert.equal((await vault.purchases(id)).status, 2n);
  assert.equal((await cardProcessor.virtualCards(id)).status, 2n);
  assert.equal(await usdToken.balanceOf(seller.address), usd("250"));
  assert.equal(await usdToken.balanceOf(cardProcessor.target), 0n);
  assert.equal(mandate.remainingQuantity, 75n);
  assert.equal(mandate.remainingBudget, usd("950"));
});

test("only the agent can charge the payment method, and fixed limits are enforced", async () => {
  const { owner, agent, outsider, vault } = await setup();
  await assert.rejects(vault.connect(owner).reservePurchase(1, ethers.id("owner-order"), 1, usd("10")));
  await assert.rejects(vault.connect(outsider).reservePurchase(1, ethers.id("outsider-order"), 1, usd("10")));
  await assert.rejects(vault.connect(agent).reservePurchase(1, ethers.id("too-expensive"), 1, usd("13")));
  await assert.rejects(vault.connect(agent).reservePurchase(1, ethers.id("too-many-units"), 101, usd("10")));
});

test("a declined buyer charge cannot consume mandate capacity", async () => {
  const { agent, cardProcessor, vault } = await setup({ buyerBalance: "100" });
  const orderId = ethers.id("insufficient-balance");

  await assert.rejects(vault.connect(agent).reservePurchase(1, orderId, 25, usd("10")));

  const mandate = await vault.mandates(1);
  assert.equal(mandate.remainingQuantity, 100n);
  assert.equal(mandate.remainingBudget, usd("1200"));
  assert.equal((await cardProcessor.virtualCards(purchaseId(1, orderId))).status, 0n);
});

test("revocation blocks unused-card capture; releasing it refunds the buyer", async () => {
  const { owner, agent, seller, usdToken, cardProcessor, vault } = await setup();
  const orderId = ethers.id("seller-order-pending");
  const id = purchaseId(1, orderId);

  await (await vault.connect(agent).reservePurchase(1, orderId, 10, usd("10"))).wait();
  await (await vault.connect(owner).revokeMandate(1)).wait();

  await assert.rejects(vault.connect(seller).settlePurchase(id));
  await assert.rejects(vault.connect(agent).reservePurchase(1, ethers.id("after-revocation"), 1, usd("10")));

  await (await vault.connect(owner).releasePurchase(id)).wait();
  assert.equal((await vault.purchases(id)).status, 3n);
  assert.equal((await cardProcessor.virtualCards(id)).status, 3n);
  assert.equal(await usdToken.balanceOf(owner.address), usd("2000"));
});
