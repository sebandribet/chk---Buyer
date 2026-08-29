/**
 * Canonical off-chain vocabulary shared by the UI, agent, merchant verifier,
 * and payment mock. It is deliberately serializable so it can travel through
 * an API, be hashed as policy evidence, and be rendered without chain access.
 */

export type ISODateTime = string;

export type MandateLifecycleStatus =
  | "Draft"
  | "Pending confirmation"
  | "Active"
  | "Revoked"
  | "Expired"
  | "Superseded"
  | "Archived";

export interface CanonicalMandatePolicy {
  currency: string;
  allowedSuppliers: string[];
  allowedCategories: string[];
  allowedSkus: string[];
  maxUnitPrice: number | null;
  maxOrderAmount: number;
  maxQuantityPerOrder: number | null;
  replenishmentFrequencyDays: number | null;
  exceptionHandling: "Block" | "Request approval";
}

export interface CanonicalMandate {
  mandateId: string | null;
  revision: number;
  status: MandateLifecycleStatus;
  owner: string;
  agent: string;
  paymentDelegate: string;
  validAfter: ISODateTime;
  expiresAt: ISODateTime;
  maxPerOperation: number;
  maxTotal: number;
  spent: number;
  reserved: number;
  policyHash: string | null;
  policy: CanonicalMandatePolicy;
}

export interface CanonicalPurchaseIntent {
  intentId: string;
  mandateId: string;
  merchant: string;
  orderReference: string;
  amount: number;
  currency: string;
  items: Array<{ sku: string; quantity: number; unitPrice: number }>;
  evidenceHashes: string[];
  createdAt: ISODateTime;
}

export interface MerchantMandatePresentation {
  mandateId: string;
  mandateRevision: number;
  agent: string;
  merchant: string;
  intentHash: string;
  authorizationId: string;
  amount: number;
  currency: string;
  expiresAt: ISODateTime;
  policyHash: string;
}
