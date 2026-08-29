/**
 * Mandato en memoria: reemplazo local del smart contract mientras el equipo de
 * mandatos termina el Solidity.
 *
 * Imita las dos propiedades de la chain que le importan al agente:
 * cada `read` devuelve el estado del momento en que se lo llama, y el estado
 * puede cambiar entre dos lecturas del mismo run sin que el agente se entere.
 * `revokeAfterReads` existe para reproducir en un test lo que en la demo hace
 * un juez apretando "revocar" mientras el agente busca.
 */

import type { Category, MandatePort, MandateState } from "@/contracts/index.js";
import type { Clock } from "@/agent/context.js";

export interface FakeMandateInit {
  mandateId: string;
  budgetTotalArs: number;
  budgetSpentArs?: number;
  maxPerPurchaseArs?: number | null;
  allowedCategories: Category[];
  allowedSuppliers?: string[] | null;
  expiresAt?: string | null;
  active?: boolean;
}

export class FakeMandatePort implements MandatePort {
  private revokedAt: string | null = null;
  private reads = 0;
  private revokeAtRead: number | null = null;

  constructor(
    private readonly init: FakeMandateInit,
    private readonly clock: Clock,
  ) {}

  /** Revocación inmediata: la próxima lectura ya la ve. */
  revoke(): void {
    this.revokedAt = this.clock.now().toISOString();
  }

  /**
   * Programa la revocación para que ocurra justo antes de la lectura N
   * (1-indexada). Con N=2 el run arranca con el mandato vivo y lo encuentra
   * revocado en la verificación previa a proponer.
   */
  revokeAfterReads(n: number): void {
    this.revokeAtRead = n;
  }

  async read(mandateId: string): Promise<MandateState> {
    if (mandateId !== this.init.mandateId) {
      throw new Error(`Mandato desconocido: ${mandateId}`);
    }

    this.reads += 1;
    if (this.revokeAtRead !== null && this.reads >= this.revokeAtRead && this.revokedAt === null) {
      this.revokedAt = this.clock.now().toISOString();
    }

    return {
      mandateId: this.init.mandateId,
      active: this.init.active ?? true,
      revokedAt: this.revokedAt,
      expiresAt: this.init.expiresAt ?? null,
      budgetTotalArs: this.init.budgetTotalArs,
      budgetSpentArs: this.init.budgetSpentArs ?? 0,
      maxPerPurchaseArs: this.init.maxPerPurchaseArs ?? null,
      allowedCategories: this.init.allowedCategories,
      allowedSuppliers: this.init.allowedSuppliers ?? null,
      readAt: this.clock.now().toISOString(),
      blockNumber: null,
      source: "fake",
    };
  }

  /** Cuántas veces el agente leyó el mandato. Un run correcto lee dos veces. */
  readCount(): number {
    return this.reads;
  }
}
