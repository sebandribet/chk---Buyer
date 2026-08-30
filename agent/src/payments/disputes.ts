/**
 * Disputas: el fake y el adapter de Stripe.
 *
 * Las dos implementaciones del mismo puerto, igual que con los cobros. El fake
 * corre offline y deja que los tests abran una disputa cuando quieren; el
 * adapter habla con Stripe de verdad, donde la tarjeta `4000000000000259`
 * produce una disputa auténtica en test mode.
 */

import Stripe from "stripe";
import type { Clock } from "@/contracts/clock.js";
import type {
  Dispute,
  DisputeEvidence,
  DisputePort,
  DisputeStatus,
  Money,
} from "../../../shared/payments.js";
import { TEST_MODE_OUTCOME } from "@/settlement/dispute.js";

// ---------------------------------------------------------------------------
// Fake
// ---------------------------------------------------------------------------

/**
 * Disputas en memoria.
 *
 * Resuelve según el mismo gancho que Stripe en test mode: si la evidencia trae
 * `winning_evidence`, gana el comercio. Se imita en vez de inventar una regla
 * propia para que el escenario offline y el real terminen igual — un caso que
 * sólo pasa en el mock es un caso que nadie probó.
 */
export class FakeDisputePort implements DisputePort {
  private readonly disputes = new Map<string, Dispute>();
  private seq = 0;

  constructor(private readonly clock: Clock) {}

  /** Abre una disputa contra un cobro. Es lo que hace el titular al desconocerlo. */
  open(captureRef: string, amount: Money, reason = "fraudulent"): Dispute {
    this.seq += 1;
    const dispute: Dispute = {
      disputeRef: `du_fake_${this.seq}`,
      captureRef,
      amount,
      reason,
      status: "needs_response",
      openedAt: this.clock.now().toISOString(),
    };
    this.disputes.set(dispute.disputeRef, dispute);
    return dispute;
  }

  async list(): Promise<Dispute[]> {
    return [...this.disputes.values()];
  }

  async read(disputeRef: string): Promise<Dispute | null> {
    return this.disputes.get(disputeRef) ?? null;
  }

  async submitEvidence(disputeRef: string, evidence: DisputeEvidence): Promise<Dispute> {
    const dispute = this.disputes.get(disputeRef);
    if (dispute === undefined) throw new Error(`No existe la disputa ${disputeRef}.`);

    const gana = evidence.uncategorizedText.includes(TEST_MODE_OUTCOME.gana);
    const pierde = evidence.uncategorizedText.includes(TEST_MODE_OUTCOME.pierde);
    const status: DisputeStatus = gana ? "won" : pierde ? "lost" : "under_review";

    const actualizada = { ...dispute, status };
    this.disputes.set(disputeRef, actualizada);
    return actualizada;
  }
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

function toStatus(status: Stripe.Dispute.Status): DisputeStatus {
  switch (status) {
    case "won":
      return "won";
    case "lost":
      return "lost";
    case "under_review":
    case "warning_under_review":
      return "under_review";
    default:
      return "needs_response";
  }
}

function toDispute(d: Stripe.Dispute): Dispute {
  return {
    disputeRef: d.id,
    captureRef: typeof d.charge === "string" ? d.charge : d.charge.id,
    amount: { minor: d.amount, currency: d.currency },
    reason: d.reason,
    status: toStatus(d.status),
    openedAt: new Date(d.created * 1000).toISOString(),
  };
}

export interface StripeDisputePortOptions {
  secretKey: string;
  client?: Stripe;
  /**
   * Cómo tiene que resolver en test mode.
   *
   * Existe porque la demo necesita un desenlace, y es preferible que el
   * interruptor esté acá, con nombre, a que viva escondido dentro del texto de
   * la evidencia. En producción no se manda: lo decide el banco.
   */
  testOutcome?: "gana" | "pierde" | null;
}

export class StripeDisputePort implements DisputePort {
  private readonly stripe: Stripe;

  constructor(private readonly options: StripeDisputePortOptions) {
    this.stripe = options.client ?? new Stripe(options.secretKey);
  }

  /**
   * Lista las disputas abiertas.
   *
   * Se pollea en vez de escuchar el webhook `charge.dispute.created` porque
   * recibir webhooks en local necesita la Stripe CLI (`stripe listen`), que
   * puede no estar instalada donde corra la demo. Pollear es menos elegante y
   * no tiene dependencias: para una demo que se opera en vivo, eso gana.
   */
  async list(): Promise<Dispute[]> {
    const page = await this.stripe.disputes.list({ limit: 20 });
    return page.data.map(toDispute);
  }

  async read(disputeRef: string): Promise<Dispute | null> {
    try {
      return toDispute(await this.stripe.disputes.retrieve(disputeRef));
    } catch {
      return null;
    }
  }

  /**
   * Presenta la evidencia.
   *
   * Los campos de texto van directo. `customer_signature`, `receipt` y
   * `customer_communication` son **archivos** en la API de Stripe (hay que
   * subirlos con la Files API, `purpose: dispute_evidence`) — acá se suben, y si
   * la subida falla la evidencia se manda igual con lo textual, que es lo que
   * sostiene el argumento. Perder el adjunto no puede costar la disputa entera.
   */
  async submitEvidence(disputeRef: string, evidence: DisputeEvidence): Promise<Dispute> {
    const files = await this.subirAdjuntos(evidence);

    const outcome = this.options.testOutcome;
    const texto =
      outcome === undefined || outcome === null
        ? evidence.uncategorizedText
        : `${TEST_MODE_OUTCOME[outcome]}\n\n${evidence.uncategorizedText}`;

    const updated = await this.stripe.disputes.update(disputeRef, {
      evidence: {
        product_description: evidence.productDescription,
        access_activity_log: evidence.accessActivityLog.slice(0, 20_000),
        uncategorized_text: texto,
        ...files,
      },
    });

    return toDispute(updated);
  }

  private async subirAdjuntos(
    evidence: DisputeEvidence,
  ): Promise<{ customer_signature?: string; receipt?: string; customer_communication?: string }> {
    const subir = async (nombre: string, contenido: string): Promise<string | undefined> => {
      try {
        const file = await this.stripe.files.create({
          purpose: "dispute_evidence",
          file: { data: Buffer.from(contenido, "utf8"), name: nombre, type: "application/octet-stream" },
        });
        return file.id;
      } catch {
        return undefined;
      }
    };

    const [customer_signature, receipt, customer_communication] = await Promise.all([
      subir("mandato-firmado-por-el-titular.txt", evidence.customerSignature),
      subir("recibo-del-vendedor.txt", evidence.receipt),
      subir("pedido-original-del-titular.txt", evidence.customerCommunication),
    ]);

    return {
      ...(customer_signature !== undefined && { customer_signature }),
      ...(receipt !== undefined && { receipt }),
      ...(customer_communication !== undefined && { customer_communication }),
    };
  }
}
