/**
 * El motor de constraints, que es lo que el merchant va a correr sin confiar
 * en nosotros.
 *
 * El test que más importa de este archivo es el del constraint desconocido. Es
 * la única regla que la spec escribe en mayúsculas y es contraintuitiva: lo
 * normal en un parser es ignorar lo que no se entiende. Acá ignorar es abrir la
 * puerta, porque un mandato al que se le agrega basura pasaría a evaluarse sólo
 * por los límites que el verificador casualmente conoce.
 */

import { describe, expect, it } from "vitest";
import {
  buildConstraints,
  evaluateConstraints,
  fromMinorUnits,
  policyHash,
  toMinorUnits,
} from "@/mandate/constraints.js";
import type { CheckoutObject, Constraint, PaymentInstrumentRef } from "../../shared/ap2.js";

const TARJETA: PaymentInstrumentRef = { ref: "pm_visa_4242", brand: "visa", last4: "4242" };
const OTRA: PaymentInstrumentRef = { ref: "pm_amex_0005", brand: "amex", last4: "0005" };

/**
 * El contexto que se evalúa: el carrito MÁS con qué se paga.
 *
 * Los límites no restringen sólo lo que se compra. `max_amount` mira el
 * carrito, `allowed_payment_instruments` mira la tarjeta, y los dos son
 * igual de parte del mandato.
 */
const compra = (c: CheckoutObject, instrumento: PaymentInstrumentRef = TARJETA) => ({
  checkout: c,
  paymentInstrument: instrumento,
});

function checkout(overrides: Partial<CheckoutObject> = {}): CheckoutObject {
  const items = overrides.items ?? [
    {
      sku: "CAFE-1KG",
      title: "Café en grano 1kg",
      category: "food",
      supplierId: "distribuidora-norte",
      quantity: 2,
      unitAmount: 1_850_000,
      lineAmount: 3_700_000,
    },
  ];

  return {
    checkoutId: "chk-1",
    merchant: { id: "distribuidora-norte", name: "Distribuidora Norte" },
    currency: "ARS",
    amount: items.reduce((a, i) => a + i.lineAmount, 0),
    items,
    deliveryDays: 2,
    createdAt: "2026-08-29T12:00:00.000Z",
    expiresAt: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

const base: Constraint[] = buildConstraints({
  allowedCategories: ["food", "cleaning"],
  allowedSuppliers: [{ id: "distribuidora-norte", name: "Distribuidora Norte" }],
  currency: "ARS",
  maxPerOperationArs: 50_000,
  maxTotalArs: 500_000,
  maxDeliveryDays: 3,
  paymentInstruments: [TARJETA],
});

describe("conversión de plata", () => {
  it("va y vuelve sin perder centavos", () => {
    expect(toMinorUnits(1234.56)).toBe(123_456);
    expect(fromMinorUnits(123_456)).toBe(1234.56);
  });

  it("redondea el flotante roto en vez de truncarlo", () => {
    // 19.99 * 100 da 1998.9999999999998 en coma flotante. Con floor serían
    // 1998 centavos: un centavo de diferencia entre el mandato y el contrato,
    // suficiente para que la verificación falle sin motivo visible.
    expect(toMinorUnits(19.99)).toBe(1999);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
  });
});

describe("camino feliz", () => {
  it("acepta un carrito que respeta todos los límites", () => {
    const verdict = evaluateConstraints(base, compra(checkout()));

    expect(verdict.passed).toBe(true);
    expect(verdict.unknownType).toBe(false);
    expect(verdict.evaluations).toHaveLength(base.length);
  });

  it("evalúa todos los constraints aunque uno ya haya fallado", () => {
    // Carrito que viola categoría Y monto Y entrega, todo junto.
    const verdict = evaluateConstraints(
      base,
      compra(checkout({
        deliveryDays: 9,
        items: [
          {
            sku: "CAFETERA",
            title: "Cafetera industrial",
            category: "equipment",
            supplierId: "distribuidora-norte",
            quantity: 1,
            unitAmount: 42_000_000,
            lineAmount: 42_000_000,
          },
        ],
      })),
    );

    // Quien audita esto quiere ver los tres, no sólo el primero que saltó.
    expect(verdict.passed).toBe(false);
    expect(verdict.evaluations.filter((e) => !e.passed).map((e) => e.type).sort()).toEqual([
      "checkout.allowed_categories",
      "checkout.max_amount",
      "checkout.max_delivery_days",
    ]);
  });
});

describe("constraint desconocido", () => {
  it("falla, en vez de ignorarse", () => {
    const conBasura = [...base, { type: "checkout.inventado", loQueSea: true } as unknown as Constraint];
    const verdict = evaluateConstraints(conBasura, compra(checkout()));

    expect(verdict.passed).toBe(false);
    expect(verdict.unknownType).toBe(true);
  });

  it("un constraint inventado no puede tapar a los que sí se entienden", () => {
    // El ataque: agregar ruido esperando que el verificador se rinda y acepte.
    const verdict = evaluateConstraints(
      [{ type: "checkout.sin_limites" } as unknown as Constraint],
      compra(checkout({ amount: 999_999_999 })),
    );

    expect(verdict.passed).toBe(false);
  });
});

describe("proveedores", () => {
  it("rechaza un vendedor fuera de la lista", () => {
    const verdict = evaluateConstraints(
      base,
      compra(checkout({ merchant: { id: "mayorista-random", name: "Mayorista Random" } })),
    );

    expect(verdict.passed).toBe(false);
    expect(verdict.evaluations.find((e) => e.type === "checkout.allowed_merchants")?.detail).toContain(
      "mayorista-random",
    );
  });

  it("rechaza al vendedor permitido que surte desde un proveedor que no lo está", () => {
    // Un marketplace puede cerrar la venta él y traer la mercadería de
    // cualquier lado. Mirar sólo el vendedor del carrito dejaría pasar eso.
    const verdict = evaluateConstraints(
      base,
      compra(checkout({
        items: [
          {
            sku: "CAFE-1KG",
            title: "Café en grano 1kg",
            category: "food",
            supplierId: "proveedor-fantasma",
            quantity: 1,
            unitAmount: 1_850_000,
            lineAmount: 1_850_000,
          },
        ],
      })),
    );

    expect(verdict.passed).toBe(false);
  });

  it("sin el constraint no hay límite de proveedor, pero con lista vacía no pasa nadie", () => {
    const sinLimite = buildConstraints({
      allowedCategories: ["food"],
      allowedSuppliers: null,
      currency: "ARS",
      maxPerOperationArs: 50_000,
      maxTotalArs: 500_000,
      maxDeliveryDays: null,
      paymentInstruments: [TARJETA],
    });
    expect(sinLimite.some((c) => c.type === "checkout.allowed_merchants")).toBe(false);
    expect(evaluateConstraints(sinLimite, compra(checkout())).passed).toBe(true);

    // Lista vacía = ninguno. Es el opuesto exacto de la ausencia, y es a
    // propósito: una lista que quedó vacía por error tiene que cerrar, no abrir.
    const listaVacia: Constraint[] = [{ type: "checkout.allowed_merchants", allowed: [] }];
    expect(evaluateConstraints(listaVacia, compra(checkout())).passed).toBe(false);
  });
});

describe("monto", () => {
  it("rechaza un carrito por encima del techo por operación", () => {
    const verdict = evaluateConstraints(base, compra(checkout({ amount: 5_000_001 })));
    expect(verdict.passed).toBe(false);
  });

  it("atrapa el total mentido: líneas caras con un total bajo declarado", () => {
    // El ataque directo. Sin re-sumar las líneas, el agente declara $1 y se
    // lleva $420.000, y todos los demás chequeos pasan.
    const verdict = evaluateConstraints(
      base,
      compra(checkout({
        amount: 100,
        items: [
          {
            sku: "CAFE-1KG",
            title: "Café en grano 1kg",
            category: "food",
            supplierId: "distribuidora-norte",
            quantity: 1,
            unitAmount: 42_000_000,
            lineAmount: 42_000_000,
          },
        ],
      })),
    );

    expect(verdict.passed).toBe(false);
    expect(verdict.evaluations.find((e) => e.type === "checkout.max_amount")?.detail).toContain(
      "does not match",
    );
  });

  it("rechaza un carrito en otra moneda", () => {
    expect(evaluateConstraints(base, compra(checkout({ currency: "USD" }))).passed).toBe(false);
  });
});

describe("policyHash", () => {
  it("no depende del orden en que se escribieron los constraints", () => {
    expect(policyHash(base)).toBe(policyHash([...base].reverse()));
  });

  it("cambia si cambia cualquier límite", () => {
    const masCaro = buildConstraints({
      allowedCategories: ["food", "cleaning"],
      allowedSuppliers: [{ id: "distribuidora-norte", name: "Distribuidora Norte" }],
      currency: "ARS",
      maxPerOperationArs: 50_001,
      maxTotalArs: 500_000,
      maxDeliveryDays: 3,
      paymentInstruments: [TARJETA],
    });

    expect(policyHash(masCaro)).not.toBe(policyHash(base));
  });

  it("cambia si se agrega una categoría", () => {
    const conEquipamiento = buildConstraints({
      allowedCategories: ["food", "cleaning", "equipment"],
      allowedSuppliers: [{ id: "distribuidora-norte", name: "Distribuidora Norte" }],
      currency: "ARS",
      maxPerOperationArs: 50_000,
      maxTotalArs: 500_000,
      maxDeliveryDays: 3,
      paymentInstruments: [TARJETA],
    });

    expect(policyHash(conEquipamiento)).not.toBe(policyHash(base));
  });
});
