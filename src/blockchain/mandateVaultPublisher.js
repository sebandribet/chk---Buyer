import {
  BrowserProvider,
  Contract,
  id,
  isAddress,
  isHexString,
  parseUnits,
} from "ethers";

/** The minimal public surface required for buyer-side mandate publication. */
export const MANDATE_VAULT_ABI = [
  "function createMandate(address agent,address merchant,bytes32 paymentMethodId,bytes32 productHash,uint256 quantity,uint256 maxUnitPrice,uint256 budget,uint64 expiresAt) returns (uint256 mandateId)",
  "event MandateCreated(uint256 indexed mandateId,address indexed owner,address indexed agent,address merchant,bytes32 paymentMethodId,bytes32 productHash,uint256 quantity,uint256 maxUnitPrice,uint256 budget,uint64 expiresAt)",
];

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function requiredAddress(value, name) {
  const address = requiredString(value, name);
  if (!isAddress(address)) throw new Error(`${name} must be a valid EVM address.`);
  return address;
}

/**
 * Converts a reviewed UI draft into the exact argument tuple stored on-chain.
 * Monetary values are decimal strings in the mock payment token's units.
 */
export function buildCreateMandateArguments(request) {
  const tokenDecimals = request.tokenDecimals ?? 6;
  const paymentMethodId = requiredString(request.paymentMethodId, "paymentMethodId");
  const expiresAt = Number(request.expiresAt);
  const quantity = BigInt(request.quantity);

  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) {
    throw new Error("tokenDecimals must be an integer between 0 and 36.");
  }
  if (!isHexString(paymentMethodId, 32)) throw new Error("paymentMethodId must be a bytes32 value.");
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error("expiresAt must be a future Unix timestamp.");
  }
  if (quantity <= 0n) throw new Error("quantity must be greater than zero.");

  const maxUnitPrice = parseUnits(requiredString(request.maxUnitPrice, "maxUnitPrice"), tokenDecimals);
  const budget = parseUnits(requiredString(request.budget, "budget"), tokenDecimals);
  if (maxUnitPrice <= 0n || budget <= 0n) throw new Error("Price and budget must be greater than zero.");
  if (budget < quantity * maxUnitPrice) {
    throw new Error("budget must cover the maximum quantity at the maximum unit price.");
  }

  return [
    requiredAddress(request.agent, "agent"),
    requiredAddress(request.merchant, "merchant"),
    paymentMethodId,
    id(requiredString(request.productReference, "productReference")),
    quantity,
    maxUnitPrice,
    budget,
    expiresAt,
  ];
}

/**
 * Publishes an owner-approved mandate through the browser wallet. The wallet
 * transaction is the owner's signature; neither the UI nor the agent handles a
 * private key.
 */
export async function publishMandate(request, options = {}) {
  const ethereum = options.ethereum ?? window.ethereum;
  const vaultAddress = requiredAddress(options.vaultAddress, "VITE_MANDATE_VAULT_ADDRESS");
  if (!ethereum) throw new Error("An EVM wallet is required to sign and publish the mandate.");

  const provider = new BrowserProvider(ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const vault = new Contract(vaultAddress, MANDATE_VAULT_ABI, signer);
  const transaction = await vault.createMandate(...buildCreateMandateArguments(request));
  const receipt = await transaction.wait();

  const createdEvent = receipt.logs
    .map((log) => {
      try {
        return vault.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "MandateCreated");

  if (!createdEvent) throw new Error("The publication transaction did not emit MandateCreated.");

  return {
    mandateId: createdEvent.args.mandateId.toString(),
    owner: createdEvent.args.owner,
    transactionHash: transaction.hash,
    blockNumber: receipt.blockNumber,
  };
}
