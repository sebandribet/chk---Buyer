import type { CanonicalMandate } from "../../shared/mandate.js";

/**
 * UI-facing mandate models for the Chk! Buyer prototype.
 *
 * These structures intentionally do not mirror the Solidity storage layout.
 * They combine signed mandate data, off-chain policy details, and audit records
 * into a display model that a mock UI can render without blockchain access.
 */

export type ISODateTime = string;
export type CurrencyCode = "USD" | "ARS" | "MXN";

export type MandateStatus =
  | "Draft"
  | "Pending confirmation"
  | "Active"
  | "Revoked"
  | "Expired"
  | "Superseded"
  | "Archived";

export type MandateAction =
  | "Create"
  | "Edit"
  | "Confirm"
  | "Revoke"
  | "Archive";

export type ExceptionHandling = "Block" | "Request approval";

export interface SupplierRule {
  supplierId: string;
  supplierName: string;
  supplierUrl?: string;
  allowedCategories: string[];
  allowedSkus: string[];
}

export interface ReplenishmentPolicy {
  suppliers: SupplierRule[];
  maxUnitPrice: number;
  maxOrderAmount: number;
  monthlyBudget: number;
  maxQuantityPerOrder: number;
  replenishmentFrequencyDays: number;
  currency: CurrencyCode;
  exceptionHandling: ExceptionHandling;
}

export interface MandateFormValues {
  name: string;
  agentName: string;
  agentAddress: string;
  paymentMethodLabel: string;
  paymentDelegateAddress: string;
  validFrom: ISODateTime;
  expiresAt: ISODateTime;
  policy: ReplenishmentPolicy;
}

export interface MandateDisplay {
  mandateId?: string;
  version: number;
  status: MandateStatus;
  form: MandateFormValues;
  createdAt?: ISODateTime;
  updatedAt: ISODateTime;
  signedAt?: ISODateTime;
  revokedAt?: ISODateTime;
  archivedAt?: ISODateTime;
  previousMandateId?: string;
  policyHash?: string;
  chainTransactionHash?: string;
  budget: {
    spent: number;
    reserved: number;
    remaining: number;
  };
  draftMetadata?: {
    sourcePrompt: string;
    openQuestions: string[];
    generatedAt: ISODateTime;
  };
}

export type RecordEventType =
  | "Mandate drafted"
  | "Mandate created"
  | "Mandate amended"
  | "Mandate revoked"
  | "Mandate expired"
  | "Mandate archived"
  | "Purchase proposed"
  | "Purchase approved"
  | "Purchase rejected"
  | "Authorization reserved"
  | "Payment completed";

export interface MandateRecordDisplay {
  recordId: string;
  mandateId?: string;
  eventType: RecordEventType;
  occurredAt: ISODateTime;
  actor: "Business owner" | "Purchasing agent" | "Policy engine" | "Payment adapter" | "System";
  title: string;
  description: string;
  policyVersion: number;
  reasonCode?: string;
  evidenceHash?: string;
  chainTransactionHash?: string;
}

export interface MandateScenario {
  label: string;
  mandate: MandateDisplay;
  records: MandateRecordDisplay[];
  availableActions: MandateAction[];
}

export function getMandateStatus(mandate: MandateDisplay, now: Date = new Date()): MandateStatus {
  if (mandate.status === "Revoked" || mandate.status === "Archived" || mandate.status === "Superseded") {
    return mandate.status;
  }

  if (mandate.status === "Draft" || mandate.status === "Pending confirmation") {
    return mandate.status;
  }

  return new Date(mandate.form.expiresAt) <= now ? "Expired" : "Active";
}

export function getAvailableMandateActions(mandate: MandateDisplay, now: Date = new Date()): MandateAction[] {
  switch (getMandateStatus(mandate, now)) {
    case "Draft":
      return ["Edit", "Confirm", "Archive"];
    case "Pending confirmation":
      return ["Edit", "Confirm", "Archive"];
    case "Active":
      return ["Edit", "Revoke"];
    case "Revoked":
    case "Expired":
    case "Superseded":
      return ["Archive"];
    case "Archived":
      return [];
  }
}

/** Converts the UI view model into the shared agent/payment/merchant vocabulary. */
export function toCanonicalMandate(
  mandate: MandateDisplay,
  owner = "business-owner",
  now: Date = new Date(),
): CanonicalMandate {
  const policy = mandate.form.policy;
  return {
    mandateId: mandate.mandateId ?? null,
    revision: mandate.version,
    status: getMandateStatus(mandate, now),
    owner,
    agent: mandate.form.agentAddress,
    paymentDelegate: mandate.form.paymentDelegateAddress,
    validAfter: mandate.form.validFrom,
    expiresAt: mandate.form.expiresAt,
    maxPerOperation: policy.maxOrderAmount,
    maxTotal: policy.monthlyBudget,
    spent: mandate.budget.spent,
    reserved: mandate.budget.reserved,
    policyHash: mandate.policyHash ?? null,
    policy: {
      currency: policy.currency,
      allowedSuppliers: policy.suppliers.map((supplier) => supplier.supplierId),
      allowedCategories: [...new Set(policy.suppliers.flatMap((supplier) => supplier.allowedCategories))],
      allowedSkus: [...new Set(policy.suppliers.flatMap((supplier) => supplier.allowedSkus))],
      maxUnitPrice: policy.maxUnitPrice,
      maxOrderAmount: policy.maxOrderAmount,
      maxQuantityPerOrder: policy.maxQuantityPerOrder,
      replenishmentFrequencyDays: policy.replenishmentFrequencyDays,
      exceptionHandling: policy.exceptionHandling,
    },
  };
}

const baseForm: MandateFormValues = {
  name: "Monthly packaging replenishment",
  agentName: "Chk! Buyer Replenishment Agent",
  agentAddress: "0xA93E...B129",
  paymentMethodLabel: "Chk! Buyer virtual card",
  paymentDelegateAddress: "0xF4C1...A882",
  validFrom: "2026-08-29T12:00:00.000Z",
  expiresAt: "2026-12-31T23:59:59.000Z",
  policy: {
    suppliers: [
      {
        supplierId: "acme-supplies",
        supplierName: "Acme Supplies",
        supplierUrl: "https://example.com/acme-supplies",
        allowedCategories: ["Packaging", "Cleaning supplies"],
        allowedSkus: ["BOX-40X30", "TAPE-48MM", "CLEAN-5L"],
      },
    ],
    maxUnitPrice: 80,
    maxOrderAmount: 250,
    monthlyBudget: 500,
    maxQuantityPerOrder: 24,
    replenishmentFrequencyDays: 14,
    currency: "USD",
    exceptionHandling: "Request approval",
  },
};

export const mandateScenarios: MandateScenario[] = [
  {
    label: "Draft generated from an owner prompt",
    mandate: {
      version: 0,
      status: "Draft",
      form: baseForm,
      updatedAt: "2026-08-29T12:05:00.000Z",
      budget: { spent: 0, reserved: 0, remaining: 500 },
      draftMetadata: {
        sourcePrompt: "Keep packaging supplies in stock from Acme, up to $500 per month.",
        openQuestions: ["Should new SKUs require approval?", "What mandate end date should be used?"],
        generatedAt: "2026-08-29T12:05:00.000Z",
      },
    },
    records: [
      {
        recordId: "record-draft-001",
        eventType: "Mandate drafted",
        occurredAt: "2026-08-29T12:05:00.000Z",
        actor: "Purchasing agent",
        title: "Draft prepared for review",
        description: "The agent converted the owner prompt into editable replenishment rules.",
        policyVersion: 0,
      },
    ],
    availableActions: ["Edit", "Confirm", "Archive"],
  },
  {
    label: "Active mandate with a pending payment reservation",
    mandate: {
      mandateId: "0x4e0f...07bc",
      version: 1,
      status: "Active",
      form: baseForm,
      createdAt: "2026-08-29T12:15:00.000Z",
      signedAt: "2026-08-29T12:15:00.000Z",
      updatedAt: "2026-09-01T09:20:00.000Z",
      policyHash: "0x55c4...9a1e",
      chainTransactionHash: "0x9912...6be4",
      budget: { spent: 180, reserved: 120, remaining: 200 },
    },
    records: [
      {
        recordId: "record-create-001",
        mandateId: "0x4e0f...07bc",
        eventType: "Mandate created",
        occurredAt: "2026-08-29T12:15:00.000Z",
        actor: "Business owner",
        title: "Mandate confirmed and signed",
        description: "The owner authorized the replenishment agent under policy version 1.",
        policyVersion: 1,
        evidenceHash: "0x55c4...9a1e",
        chainTransactionHash: "0x9912...6be4",
      },
      {
        recordId: "record-reserve-001",
        mandateId: "0x4e0f...07bc",
        eventType: "Authorization reserved",
        occurredAt: "2026-09-01T09:20:00.000Z",
        actor: "Policy engine",
        title: "USD 120 reserved for Acme Supplies",
        description: "The proposed order satisfies the supplier, SKU, quantity, and budget rules.",
        policyVersion: 1,
      },
    ],
    availableActions: ["Edit", "Revoke"],
  },
  {
    label: "Revoked mandate",
    mandate: {
      mandateId: "0x4e0f...07bc",
      version: 1,
      status: "Revoked",
      form: baseForm,
      createdAt: "2026-08-29T12:15:00.000Z",
      signedAt: "2026-08-29T12:15:00.000Z",
      updatedAt: "2026-09-02T10:00:00.000Z",
      revokedAt: "2026-09-02T10:00:00.000Z",
      policyHash: "0x55c4...9a1e",
      budget: { spent: 180, reserved: 0, remaining: 320 },
    },
    records: [
      {
        recordId: "record-revoke-001",
        mandateId: "0x4e0f...07bc",
        eventType: "Mandate revoked",
        occurredAt: "2026-09-02T10:00:00.000Z",
        actor: "Business owner",
        title: "Mandate revoked immediately",
        description: "All later purchase attempts must be rejected. Previous records remain available for audit.",
        policyVersion: 1,
        reasonCode: "OWNER_REVOKED",
      },
    ],
    availableActions: ["Archive"],
  },
  {
    label: "Amended mandate with a new policy version",
    mandate: {
      mandateId: "0x9b18...e311",
      previousMandateId: "0x4e0f...07bc",
      version: 2,
      status: "Active",
      form: {
        ...baseForm,
        policy: {
          ...baseForm.policy,
          monthlyBudget: 650,
          maxOrderAmount: 300,
        },
      },
      createdAt: "2026-09-03T08:10:00.000Z",
      signedAt: "2026-09-03T08:10:00.000Z",
      updatedAt: "2026-09-03T08:10:00.000Z",
      policyHash: "0xaa34...7c91",
      budget: { spent: 180, reserved: 0, remaining: 470 },
    },
    records: [
      {
        recordId: "record-amend-001",
        mandateId: "0x9b18...e311",
        eventType: "Mandate amended",
        occurredAt: "2026-09-03T08:10:00.000Z",
        actor: "Business owner",
        title: "Budget and per-order cap updated",
        description: "The owner confirmed policy version 2. Earlier pending authorizations are invalidated.",
        policyVersion: 2,
        reasonCode: "OWNER_POLICY_UPDATE",
      },
    ],
    availableActions: ["Edit", "Revoke"],
  },
  {
    label: "Archived mandate retained for audit",
    mandate: {
      mandateId: "0x4e0f...07bc",
      version: 1,
      status: "Archived",
      form: baseForm,
      createdAt: "2026-08-29T12:15:00.000Z",
      updatedAt: "2026-09-03T08:20:00.000Z",
      revokedAt: "2026-09-02T10:00:00.000Z",
      archivedAt: "2026-09-03T08:20:00.000Z",
      budget: { spent: 180, reserved: 0, remaining: 320 },
    },
    records: [
      {
        recordId: "record-archive-001",
        mandateId: "0x4e0f...07bc",
        eventType: "Mandate archived",
        occurredAt: "2026-09-03T08:20:00.000Z",
        actor: "Business owner",
        title: "Mandate removed from active workspace",
        description: "The mandate is no longer shown in the active list, but its history remains available for audit.",
        policyVersion: 1,
      },
    ],
    availableActions: [],
  },
];
