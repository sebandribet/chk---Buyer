/**
 * Contexto de un run: reloj, generador de ids y log de auditoría.
 *
 * Nada del agente llama a `Date.now()` ni genera ids al azar por su cuenta.
 * Todo pasa por acá y todo es inyectable, así un run es reproducible: mismo
 * mandato + mismo catálogo + mismo reloj + mismos fixtures => mismo trail,
 * evento por evento. Eso es lo que hace que los golden tests sirvan de algo.
 */

import type { AuditEvent, AuditEventInput, AuditLog } from "@/contracts/index.js";

export interface Clock {
  now(): Date;
}

/** Reloj congelado. Es el que usan los tests para probar vencimientos sin esperar. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  /** Avanza el reloj: sirve para simular que pasó tiempo entre dos runs. */
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date): void {
    this.current = new Date(date);
  }
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Ids secuenciales y predecibles: "run_1", "cart_1". */
export class SeqIds {
  private counters = new Map<string, number>();
  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${n}`;
  }
}

export class InMemoryAuditLog implements AuditLog {
  private readonly log: AuditEvent[] = [];
  private seq = 0;

  constructor(
    private readonly runId: string,
    private readonly clock: Clock,
  ) {}

  emit(event: AuditEventInput): void {
    this.seq += 1;
    this.log.push({
      ...event,
      runId: this.runId,
      at: this.clock.now().toISOString(),
      seq: this.seq,
    } as AuditEvent);
  }

  events(): readonly AuditEvent[] {
    return this.log;
  }
}

export interface AgentContext {
  runId: string;
  clock: Clock;
  ids: SeqIds;
  audit: AuditLog;
}

export function createContext(clock: Clock, ids: SeqIds = new SeqIds()): AgentContext {
  const runId = ids.next("run");
  return { runId, clock, ids, audit: new InMemoryAuditLog(runId, clock) };
}
