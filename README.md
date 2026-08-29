# Chk! Buyer

MVP para el Challenge 1 de NextWave Hackathon 2026: **"The Buyer Who Isn't Human"**.

Chk! Buyer permite que un humano delegue compras a un agente de IA sin entregar su medio de pago ni perder control sobre la operación. El producto se divide en cuatro bloques: **Mandates** (este módulo), UI/UX, pagos y agente.

## Alcance del MVP

Demostraremos el circuito completo: el usuario crea un mandate, el agente intenta comprar, el comercio verifica la autorización y el usuario recibe un comprobante. Una compra fuera de alcance, con mandate vencido o revocado debe rechazarse o escalarse al usuario, nunca aprobarse en silencio.

Caso guía: Marta autoriza a su agente a comprar un vuelo a Córdoba por hasta USD 150 hasta fin de mes. El jurado podrá cambiar límites o revocar el mandate en vivo y el siguiente intento deberá fallar.

## Mandates: decisión técnica inicial

Un mandate es una autorización firmada y verificable, no un medio de pago ni una transferencia de fondos. Elegimos un diseño híbrido:

- **Mandate firmado:** el usuario firma un payload EIP-712 con su wallet. Contiene `mandateId`, usuario, identidad pública del agente, vigencia, política y `nonce`.
- **Política versionada:** límites por operación y período, moneda, categorías/merchant permitidos, método de pago o token delegado permitido, condiciones y acción ante excepción (`deny` o `require_approval`). El documento completo queda off-chain; su hash queda firmado y anclado.
- **Registro de estado en Polygon:** un contrato `MandateRegistry` conserva el hash, emisor, agente autorizado, `expiresAt`, versión/nonce y estado (`active`/`revoked`). La revocación es una transacción del usuario y es efectiva de inmediato para cualquier validación posterior.
- **Servicio de verificación:** antes de emitir una autorización de pago de un solo uso, valida firma, integridad de política, identidad del agente, TTL, estado on-chain, límites acumulados y coincidencia de la intención de compra. El merchant/pagos nunca confía solo en lo que declara el agente.
- **Auditoría:** cada alta, verificación, denegación, aprobación, uso y revocación genera un evento inmutable con hashes de la intención, decisión y evidencia; sin guardar datos de tarjeta ni PII innecesaria on-chain.

El smart contract es el ancla de estado compartido y revocable; no modelamos cada regla de negocio on-chain. Esto mantiene costos y privacidad razonables y permite integrar cualquier rail de pago. Para el pago real, el bloque de pagos deberá exigir una autorización efímera ligada a `mandateId`, intención, monto, merchant y expiración corta, evitando replay.

## Invariantes de seguridad

1. Un agente solo puede actuar si el mandate está activo, no expiró y su clave coincide.
2. Revocación y expiración prevalecen sobre cualquier token previo; la validación final consulta estado fresco.
3. Toda compra debe satisfacer la política vigente o escalar/rechazar.
4. Un intento no puede reutilizar una autorización ni exceder el presupuesto acumulado de forma concurrente.
5. Humano, merchant y auditor pueden reconstruir qué se autorizó, qué se intentó y por qué se decidió.

## Referencias de diseño

- El brief del challenge exige mandates con límites, verificación, revocación, manejo de disputa y trail auditable.
- AP2 inspira el mandate como autorización firmada y auditable; sus etapas Open/Closed separan restricciones de usuario de una transacción cerrada.
- ACP inspira el token de pago delegado limitado por monto y vencimiento. La liquidación queda desacoplada de la autorización.

## Decisiones a cerrar

- Esquema exacto de la política y de la intención de compra.
- Modelo de identidad del usuario y agente (wallet, DID o ambos).
- Semántica de presupuesto acumulado, reservas y concurrencia.
- Interfaz de aprobación humana, disputa y evidencia visible para cada parte.
