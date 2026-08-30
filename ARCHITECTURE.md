# Chk! Buyer Architecture

This Mermaid diagram is the editable source of the architecture. Edit node text
or arrows directly in this file; GitHub will render it automatically.

Legend: solid arrows are implemented in the current mock, dotted arrows are
the selected target architecture or an integration not yet connected.

```mermaid
flowchart LR
    classDef current fill:#d9f7e8,stroke:#16794d,color:#102b1d
    classDef mock fill:#fff1cc,stroke:#a76b00,color:#3f2a00
    classDef target fill:#e2e8ff,stroke:#4059b8,color:#162457
    classDef external fill:#f2f2f2,stroke:#666,color:#222

    subgraph buyer[Buyer]
        U[Real user<br/>Creates, reviews, signs,<br/>revokes]:::current
        TW[Traditional payment method<br/>Selected product UX]:::target
        BW[Browser EVM wallet<br/>Current publication bridge]:::mock
    end

    subgraph draft[Mandate drafting]
        D[Agent-generated mandate draft<br/>Editable before confirmation<br/>product, budget, vendors, validity]:::current
        R[Buyer review and confirmation]:::current
    end

    subgraph chain[Shared authorization layer - Polygon mock]
        M[MandateVault mandate<br/>owner, agent, merchant,<br/>payment method ID, product hash,<br/>quantity, unit-price cap, budget,<br/>expiry, active/revoked status]:::current
        V[Versioned amendment and policy hash<br/>Selected mandate capability<br/>Not yet consolidated into MandateVault]:::target
    end

    subgraph agent[Purchasing agent]
        DE[Discovery engine<br/>Scrapes and normalizes offers]:::current
        CE[Decision engine<br/>Evaluates policy and proposes<br/>or reserves an order]:::current
    end

    subgraph payment[Payment path]
        PM[Payment adapter<br/>MockCardProcessor + MockUSD<br/>Current mock]:::mock
        VC[Merchant-specific, one-use<br/>virtual card authorization]:::mock
        TF[TradFi payment adapter<br/>Hides blockchain operations<br/>from the buyer]:::target
    end

    subgraph producer[Producer / merchant]
        P[Producer storefront / order endpoint<br/>Publishes offer details]:::external
        MV[Merchant verification<br/>Checks active mandate, agent,<br/>merchant, expiry, and limits]:::current
        S[Order acceptance and settlement]:::external
        ST[Stripe checkout mock<br/>Selected, not implemented]:::target
    end

    U -->|describes purchase goal| D
    D -->|reviewable draft| R
    R -->|buyer confirms| U
    U -->|signs createMandate transaction| BW
    BW -->|publishes static authorization| M
    U -->|revokes mandate| M
    U -.->|chooses payment method| TW
    R -.->|future amendment creates<br/>a new mandate revision| V
    V -.->|future consolidation| M

    P -->|offers, prices, availability| DE
    DE -->|normalized eligible offers| CE
    M -.->|fresh mandate state<br/>through a chain reader| CE
    CE -->|reservePurchase within<br/>static on-chain limits| M

    M -->|approved reservation| PM
    PM -->|issues exact amount,<br/>one-use credential| VC
    VC -->|merchant-specific payment| S
    TW -.->|funds an approved order| TF
    TF -.->|future replacement for mock path| PM

    P -->|incoming agent order| MV
    MV -->|reads mandate and purchase state| M
    MV -->|accept or reject| S
    ST -.->|future merchant checkout| S

    M -->|revocation blocks new reservations<br/>and unused-card capture| PM
```

## Current implementation notes

- `MandateVault` is an authorization ledger, not a user-funds wallet. In the
  mock, `MockCardProcessor` charges at reservation and holds mock USD until the
  merchant captures or releases the virtual card.
- A browser EVM wallet currently signs `createMandate`. This proves publication
  for the mock, but conflicts with the selected TradFi-first buyer UX; a
  production adapter or relayer remains to be designed.
- `MandateVault` currently supports creation and revocation. Versioned
  amendments and a complete policy hash exist in the separate `MandateModule`
  prototype and are not yet part of the canonical payment flow.
- The agent's discovery and decision modules exist, but the live chain reader
  and UI-to-agent execution bridge are not connected yet.
- The mock virtual-card path is implemented. Stripe is a selected merchant
  checkout direction, not an implemented integration.
