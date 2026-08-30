# Agentic environment — Challenge 1 · "The Buyer Who Isn't Human"

Módulo del agente comprador: **desde el prompt del humano hasta la propuesta de compra**.
No cobra. Emite un `CartDraft` verificado contra el mandato y ahí termina su frontera.

Caso: una cafetería le da un mandato a su agente para reponer insumos en un marketplace
con varios proveedores. El mandato vive en un smart contract; el agente solo lo lee.

## Cómo correrlo

El agente vive en `agent/`, con su propio `package.json`, aparte de la app del
front que está en la raíz. Todos los comandos se corren desde ahí:

```bash
cd agent
npm install
npm test          # 100 tests, offline, ~280ms — no necesita API key
npm run typecheck
```

### Para que ande contra el modelo (30 segundos)

```bash
cp .env.example .env
```

Y pegá dentro la `OPENAI_API_KEY` que te pasa Nico por privado.

**La key no está en el repo a propósito.** Este repo es público, GitHub escanea
secretos y OpenAI es partner de ese escaneo: una key commiteada acá se revoca sola
en minutos y rompe el demo. Además queda en el historial de git para siempre, aunque
después se borre del archivo.

```bash
npm run demo -- --prompt "Comprá 2 kilos de café molido, hasta \$60.000"
```

Para correr el agente contra el modelo de verdad:

```bash
cp .env.example .env      # completar OPENAI_API_KEY, y NO fijar LLM_MODE
npm run demo -- --prompt "Reponé 12 litros de leche descremada y 2 kilos de café, hasta \$200.000"
```

### Modos del LLM — importa para el demo

| Modo | Para qué |
|---|---|
| `live` (default con key) | **El demo y la trial by fire.** Único modo que responde un prompt nuevo. |
| `replay` | Tests y ensayo. Offline y gratis, pero **solo conoce los prompts grabados**. |
| `record` | Grabar fixtures nuevos: `npm run record`. |

Con la key en `.env` y sin `LLM_MODE`, `npm run ui` y `npm run demo` salen en `live`.
Los tests siempre corren en `replay` (lo fija `vitest.config.ts`), así que no gastan
créditos ni dependen de la red.

**No corras el demo en `replay`.** Un prompt que no está grabado no da una
respuesta peor: da un error. Y la trial by fire es, por definición, un prompt
que nadie ensayó.

Escenarios de la demo:

```bash
npm run demo -- --prompt "..." --revoke-mid-run   # el juez revoca mientras el agente busca
npm run demo -- --prompt "..." --expired          # mandato vencido
npm run demo -- --prompt "..." --no-mandate       # sin mandato firmado: sugiere, no compra
npm run demo -- --prompt "Comprá una cafetera, hasta \$200.000"   # categoría fuera del mandato
```

El contraste que muestra la feature, con la misma canasta:

| Prompt | Resultado |
|---|---|
| "Reponé 12L de leche descremada y 2kg de café, hasta $200.000" | `proposal` — compra, $53.800 |
| "¿Cuánto me saldría reponer 12L de leche descremada y 2kg de café?" | `suggestion` — mismo carrito, $53.800, no compra |
| Cualquiera de los dos, sin mandato firmado | `suggestion (no_mandate)` — ni lee el mandato |

## La interfaz

**No está en este branch.** Acá va el agente headless: el motor, el catálogo y el
CLI. La UI web (chat + pestaña "detrás del chat") vive aparte para que quien la
integre no tenga que arrastrar un servidor de pruebas.

Todo lo que la UI muestra sale de `AuditEvent[]`, así que quien la reimplemente
consume la misma traza. Cuando existía, tenía dos pestañas sobre el mismo run:

**Chat** — lo que ve el usuario. El agente repregunta cuando le falta un dato,
ofrece opciones cuando las tiene, muestra el carrito, escala o rechaza. Conversación
de varios turnos.

**Detrás del chat** — lo que arma por dentro: el prompt efectivo que recibió el
modelo, la ficha del pedido, la decisión de comprar o sugerir con su motivo, los
intentos de manipulación detectados, y la traza auditable completa de todos los turnos.

### La voz del agente

Lo que la persona lee lo redacta un módulo aparte (`src/agent/reply.ts`) que corre
**después** de decidir, sobre el resultado ya cerrado. Recibe hechos y devuelve un
string: su schema de salida no tiene precios, ni productos, ni aprobaciones, así
que no puede cambiar qué pasó — solo cómo se cuenta.

Sin esto, la persona leía el razonamiento interno del sistema: *"el pedido se leyó
como una consulta, no como una orden de compra"*.

Dos frenos en código, no en el prompt — una instrucción se puede desobedecer:

| Freno | Qué ataja |
|---|---|
| cifras inventadas | toda cifra de plata tiene que ser una de las que se le pasaron |
| acciones inexistentes | "compré", "cancelo el pedido", "te aviso cuando baje" |

Si alguno salta, la respuesta se arma con una plantilla en código y la conversación
sigue igual. El segundo importa especialmente: **el agente nunca compra, prepara el
pedido** — el cobro es del equipo de pagos, y confundir eso destruye justo la
separación que el challenge pide demostrar.

### Refinamientos: calidad y marca

El pedido se construye de a pedazos. "Comprame café" → "2 kilos" → "hasta 80 mil"
→ "pero quiero de mejor calidad" → "¿y si quiero Lavazza?" es **un solo pedido que
evoluciona**, y cada turno vuelve a correr el agente con la conversación entera.

`qualityPreference: premium` no ordena por precio al revés —comprar caro no es
comprar mejor—. Usa las dos únicas señales de gama que el catálogo trae: descarta
la marca propia del supermercado (el escalón económico declarado) y entre las que
quedan prefiere la de mayor precio unitario **que entre en el presupuesto**. Es un
proxy declarado: no tenemos datos de calidad, tenemos marca y precio.

El techo lo sigue poniendo el mandato. "Lo mejor" nunca es "lo que sea".

### Pedir por plata, no por cantidad

*"Comprame un café de 20 lucas"* no es un pedido de 1 kg de café. La plata **es**
la especificación, y "un café" es un envase, no un kilo.

`NeedSpec.anchor` distingue los dos casos:

| Anclaje | Ejemplo | Qué manda |
|---|---|---|
| `quantity` | "2 kilos de café molido" | `qty` y `unit` |
| `budget` | "un café de 20 lucas" | `itemBudgetArs`: se lleva **un envase**, el que mejor use esa plata |

Sin esta distinción el agente hacía una de dos cosas, las dos mal: convertía "un
café" en "1 kg de café" —una cantidad que nadie pidió— o preguntaba el presupuesto
que la persona acababa de decir.

El extractor también entiende plata en argentino: **luca** (mil), **palo** (millón),
**gamba** (cien), **mango** (peso), y que en `$20.000` el punto separa miles.

### Las gamas salen del precio por unidad

`económica` / `intermedia` / `premium` se calculan con el **precio por unidad dentro
del rubro**, no con la marca. La marca la escribe cada tienda a mano —a veces es la
del súper, a veces la del fabricante, a veces está vacía—; el precio por kilo o por
litro siempre está y siempre significa lo mismo.

La interfaz muestra las dos cifras, total y precio por unidad, porque no siempre van
en el mismo orden: una bolsa de 5kg puede ser la más barata **por kilo** y la más
cara **a pagar** si solo necesitás 2kg. Mostrar solo una de las dos hace que la lista
parezca rota.

### Cotizar ≠ comprar: el presupuesto no recorta una consulta

El presupuesto define qué se puede **comprar**, no qué se puede **mostrar**.
Recortar una cotización al techo esconde justo la información que se está pidiendo:
cuánto más sale el bueno.

Al cotizar, el agente devuelve un abanico de hasta tres gamas por ítem —económica,
primera marca y premium— **incluyendo las que se pasan del presupuesto, marcadas**:

```
2kg de café, presupuesto ~$40.000
  [económica  ]  $36.000   Café Molido Torrado La Virginia 125 Gr.
  [intermedia ]  $83.350   Cafe Tostado Molido Bonafide          ⚠ arriba
  [premium    ] $256.000   Café Molido 250 Grs Lavazza           ⚠ arriba
```

La distinción es un campo del scope de selección (`enforceBudget`): al comprar el
presupuesto ordena los candidatos, al cotizar solo los etiqueta. Los dos lados están
fijados por tests — que se muestren opciones por encima al cotizar, y que **no** se
puedan comprar por encima aunque se pida calidad premium.

El agente **no guarda estado entre turnos**. La conversación vive en el cliente y
cada run recibe el pedido original más las aclaraciones acumuladas — por eso un run
se reproduce con solo su prompt efectivo, que es exactamente lo que muestra la
segunda pestaña. Si el servidor guardara sesión, reconstruir por qué el agente
decidió algo exigiría reconstruir también el estado que tenía en ese momento.

En el chat se muestra **una pregunta por turno** aunque el agente haya devuelto
varias: hay un solo cuadro de texto, y ofrecer tres preguntas con un solo campo
asocia la respuesta a la pregunta equivocada.

## Arquitectura

```
prompt ──► E1 intent ──► E3 discover ──► E4 decide ──► CartDraft ──► [equipo de pagos]
             (LLM)         (catálogo)      (código)         │
                                                            ├──► escalación a humano
                                                            └──► rechazo
                   ▲                                  ▲
                   └────────── MandatePort (solo lectura, on-chain) ──────┘
                              se lee 2 veces: antes de buscar y antes de proponer
```

Todo el run emite `AuditEvent[]`: es el trail auditable y lo que consume la UI.

### Nivel de compromiso: comprar vs sugerir

El agente clasifica cuán comprometido está el pedido — `exploratory`, `conditional`
o `committed` — y con eso decide si ejecuta o solo sugiere. Se clasifica por la
**estructura** del pedido (¿hay ítem, cantidad y verbo imperativo de compra?, ¿hay
una condición pendiente?), nunca por el tono: urgencia y seguridad son las
herramientas de la ingeniería social, así que no se miden.

**La regla que sostiene el diseño: el compromiso solo puede RESTRINGIR.** Nunca
habilita una compra que el mandato firmado no permitiera ya, y nunca crea un
mandato — la firma es un acto del humano con su clave.

Por eso los dos modos de falla son seguros:

| Si el modelo lee mal… | Qué pasa |
|---|---|
| `exploratory` de más | Sugiere en vez de comprar. Molesto, inofensivo. |
| `committed` de más | Nada que el mandato firmado no permitiera ya. |

El orden de los chequeos en `src/agent/run.ts` es lo que lo garantiza: primero se
pregunta si hay mandato (y ahí el compromiso ni se consulta), después si el pedido
es una orden. El segundo paso solo puede convertir un "sí" en un "no".

Cuando no ejecuta, el agente igual hace todo el trabajo —busca, compara, arma el
carrito— y devuelve una `Suggestion` con un **borrador de mandato** de mínimo
privilegio: presupuesto derivado del carrito real (no un número con margen) y solo
las categorías que ese carrito necesita.

La garantía es estructural, no una bandera: `suggest()` recibe `DiscoveryDeps`, que
no incluye `MandatePort`. No tiene forma de llegar a uno.

### El catálogo: datos reales con procedencia

```bash
npm run scrape    # baja precios reales y los congela en catalog.scraped.json
```

Lee los catálogos públicos de **Jumbo, Día y Carrefour** (los tres corren sobre
VTEX, que expone un endpoint JSON — es la misma API que usa el buscador de la
tienda, no scraping de HTML). Hoy: **1285 productos en 55 rubros** — almacén,
lácteos, bebidas sin alcohol, limpieza y descartables — cada uno con
`source: { store, url, fetchedAt }`. Cada precio se puede abrir y verificar.

Si el archivo no existe, el agente usa el marketplace inventado de `data.ts`. El
comportamiento del sistema es idéntico con uno u otro.

#### Búsqueda en vivo y refresco

El catálogo congelado es el piso, no el techo. Tres comportamientos, y lo que los
separa es qué tan caro es esperar:

| Situación | Qué hace |
|---|---|
| **el rubro no está** | busca en vivo y el run espera — sin datos la alternativa es "no lo encontré", que es peor |
| **está pero venció** | devuelve lo que hay ahora y refresca en segundo plano — nadie debería esperar por un precio de ayer |
| **está fresco** | lo devuelve |

Pedile "10 kilos de garbanzos": no está en los 55 rubros, así que el agente arma el
plan de búsqueda, baja ~26 productos reales en ~3 segundos y decide sobre ellos. El
rubro queda guardado, así que el siguiente pedido no espera nada.

El vencimiento es **por rubro, no global**, porque no todo se mueve igual:

| Perfil | TTL | Para qué |
|---|---|---|
| `estable` | 3 días | secos, limpieza, descartables |
| `diario` | 24 h | alimentos y todo lo que tenga promo semanal |
| `intradia` | 45 min | precio dinámico — vuelos, hotelería |

Hoy ningún rubro nuestro es `intradia`: el escalón existe porque el mecanismo tiene
que soportarlo el día que agreguemos uno, no porque lo usemos.

**Nada de esto puede romper un run.** Si una tienda no responde, tarda de más o
devuelve basura, se sigue con lo que había y queda en la traza (`catalog_fetch_failed`).
Un agente que falla porque un supermercado cambió su API es un agente que falla
delante del jurado.

#### Un rubro nuevo necesita una categoría, y la categoría es lo que el mandato filtra

Si el agente sale a buscar "whisky" y lo clasifica como `alimentos`, se saltea una
restricción del mandato sin que nadie lo note. Por eso son dos pasos con roles
distintos:

1. el modelo **propone** categoría, término de búsqueda y unidades esperadas
2. una lista de palabras en código puede **forzar** una categoría restringida

La asimetría es la garantía: el paso 2 solo mueve productos **hacia** categorías
restringidas, nunca al revés. Un modelo equivocado —o convencido de equivocarse—
puede a lo sumo dejar algo más restringido de lo que corresponde.

Probado de punta a punta: "comprá 3 botellas de whisky" baja productos reales que el
catálogo nunca tuvo, y el mandato los rechaza igual.

**El demo NO scrapea en vivo.** Se baja una vez, se revisa, se congela. Una
tienda que cambia su API no puede ser el motivo por el que el agente no encuentra
nada delante del jurado.

**Ningún precio sale de un modelo.** Precio, stock y tamaño vienen del JSON de la
tienda y de un parser determinístico. El pipeline descarta antes de publicar:

| Filtro | Por qué |
|---|---|
| sin tamaño legible en el nombre | sin tamaño no hay precio por unidad, y sin eso comparar es ruido |
| precio fuera de rango | Jumbo devuelve `ListPrice: 2644628` junto a `Price: 32000` para el mismo producto |
| precio lejos de la mediana del rubro | apareció leche a $220/L junto a leche a $1700/L |
| palabra excluida | el buscador no sabe que somos una cafetería: "detergente" trae jabón para ropa, "alcohol en gel" trae lavandina en gel y "té" trae café en saquitos |

Las exclusiones no se adivinaron: se auditó el catálogo bajado buscando productos
cuyo título no contiene la palabra del rubro, y se agregó una exclusión por cada
familia de ruido encontrada.

### Reformulación del pedido

El agente reconstruye el pedido de forma explícita antes de actuar, y lo hace
distinto según el compromiso. La asimetría va al revés de lo intuitivo:

**`committed` → ficha de pedido, determinística.** Se genera desde el
`PurchaseIntent` ya validado, no desde el prompt, así que por construcción no
puede afirmar nada que el humano no haya dicho. Lo que falta lo declara faltante:

```
Qué                    5 kg de arroz (tipo: yamani) · 10 kg de avena (tipo: instantanea)
Techo de gasto         $20.000
Para cuándo            entrega en hasta 6 día(s)
Sustitutos             no se aceptan
Proveedores            cualquiera de los que habilite el mandato
sin especificar        vigencia del pedido
```

Es lo que el humano confirma, lo que el merchant recibe y lo que resuelve una
disputa. El prompt original se conserva al lado, sin reformular: en un conflicto
importan los dos, y si difieren, esa diferencia **es** la evidencia.

**`exploratory` / `conditional` → brief de búsqueda, con modelo.** Acá sí se
expande: "estoy viendo opciones de detergente" no trae cantidad, y frenar a
preguntar "¿cuánto necesitás?" es peor respuesta que mostrar los precios. El
modelo elige una cantidad de referencia y explica de dónde salió; las
necesidades viajan marcadas con `isReference` para que nadie las confunda con
algo que el humano pidió.

**Por qué la asimetría:** el modelo tiene permitido imaginar exactamente donde no
hay una tarjeta del otro lado. Una ficha que "completa" un pedido de compra con
valores razonables es el mecanismo por el que un agente compra lo que nadie pidió
—con una explicación prolija de por qué estaba bien—. En una sugerencia, lo peor
que puede pasar es cotizar de más.

### Dónde interviene el modelo, y dónde no

El LLM interviene en exactamente dos lugares, ambos semánticos:

1. **Extraer el intent** del prompt (lenguaje natural → estructura tipada).
2. **Juzgar si un sustituto es equivalente** a lo pedido ("¿leche entera reemplaza a descremada?").

Todo lo demás —límites, categorías, proveedores, presupuesto, stock, precios, revocación—
es código determinístico en `src/agent/policy.ts`. Ese archivo no recibe texto libre ni
llama a ningún modelo.

**Por qué:** si el enforcement viviera en un prompt, un agente adversarial o un vendedor
que escribe instrucciones en la descripción de su producto podría negociar con él. Contra
el policy engine no hay con quién negociar. La respuesta del modelo sobre un sustituto es
un *insumo* de la selección, nunca una autorización: los chequeos de mandato corren después,
sobre lo que sea que el modelo haya elegido.

## Garantías, y el test que las sostiene

| Garantía | Test |
|---|---|
| No compra fuera de la categoría del mandato | `rechaza una categoría que el mandato no habilita` |
| El prompt no puede ampliar el mandato, solo restringirlo | `el prompt no puede ampliar el mandato` |
| Excederse escala a un humano; nunca se aprueba ni se descarta solo | `escala a un humano cuando excede el presupuesto` |
| Revocar a mitad del run frena la compra | `un mandato revocado a mitad del run frena la propuesta` |
| Un mandato vencido corta antes de buscar | `un mandato vencido corta antes de buscar nada` |
| Un producto que da instrucciones no tiene efecto | `ignora un producto que le da instrucciones` |
| No inventa datos que el humano no dio | `pregunta en vez de asumir un presupuesto` |
| No le cree al modelo cuando dice que entendió | `pregunta la cantidad aunque el modelo haya dicho que entendió` |
| No sustituye sin permiso explícito | `ni le pregunta al modelo si el humano no habilitó sustitutos` |
| **Sin mandato firmado no compra, por comprometido que suene el pedido** | `un pedido máximamente comprometido sigue sin poder comprar` |
| El compromiso no saltea el mandato | `comprometido + revocado = rechazo` |
| Una consulta no dispara una compra | `un pedido exploratorio sugiere en vez de comprar` |
| **La ficha declara lo que falta, no lo completa** | `declara lo que falta en vez de completarlo` |
| Una orden de compra nunca inventa qué comprar | `una orden de compra sin cantidad sigue frenando a preguntar` |
| Una consulta sin cantidad se cotiza, no se interroga | `cotiza una consulta sin cantidad, en vez de frenar a preguntar` |

## Decisiones (extracto para el decision log)

**AP2 en vez de formato propio.** La salida de E1 tiene la forma del `IntentMandate` de
[AP2](https://ap2-protocol.org): descripción en lenguaje natural, allowlist de merchants,
constraints y expiración. Alternativa considerada: inventar el formato, más rápido pero
indefendible ante "¿por qué así?". Descartada: AP2 ya resolvió el problema y el equipo de
mandatos necesita un esquema estable para el contrato.

**ACP descartado.** Lo evaluamos para la comunicación agente↔merchant. Está absorbido por
A2A bajo la Linux Foundation y su propia documentación linkea la guía de migración: construir
sobre él hoy es construir sobre algo que ya se movió. AP2 se distribuye además como extensión
de A2A, así que A2A es el camino coherente.

**Se decide por costo total de cubrir la necesidad, no por precio unitario.** El café a
$16.800/kg viene en bolsa de 5kg; el de $18.500/kg viene por kilo. Para 2kg, el "más barato
por kilo" cuesta $84.000 y el otro $37.000, porque los packs no se parten. La normalización
por unidad sigue siendo necesaria para comparar presentaciones y calcular packs, pero como
criterio de decisión hace que el agente gaste el doble creyendo que optimizó.

**El mandato se lee dos veces por run, y nunca se cachea.** Con el mandato on-chain, revocar
es una transacción con latencia. Si el agente leyera una sola vez al arrancar, una revocación
durante la búsqueda no tendría efecto — que es justamente lo que el jurado va a probar en vivo.
La segunda lectura, previa a proponer, es la que lo atrapa.

**El LLM detrás de una interfaz con modo replay.** Los tests corren offline, gratis y
determinísticos contra fixtures grabados. Un agente cuyo comportamiento solo se puede
verificar gastando créditos no se puede verificar. Costo asumido: la clave del fixture ignora
el system prompt, así que cambiarlo no invalida las grabaciones — hay que re-grabar a mano.

## Estructura

```
src/
  contracts/   Tipos compartidos por los 4 módulos del equipo. El contrato es código.
  catalog/     Marketplace mockeado (4 proveedores) + búsqueda y normalización.
  agent/
    intent.ts    E1 · prompt → IntentMandate draft
    decide.ts    E3+E4 · discover + decide
    policy.ts    Policy engine determinístico. Sin LLM, sin texto libre.
    untrusted.ts Todo lo que viene del catálogo es dato hostil.
    context.ts   Reloj, ids y log de auditoría inyectables ⇒ runs reproducibles.
  mandate/fake.ts  Stub local del contrato Solidity (solo lectura).
  llm/         Cliente OpenAI + replay/record de fixtures.
  cli/         Demo por terminal.
```

## Costuras con el resto del equipo

- **Mandatos (Solidity):** implementan `MandatePort` de `src/contracts/mandate.ts`. Es una
  interfaz de una sola función y **solo de lectura** — el agente no puede crear ni ampliar
  su propia autorización.
- **Pagos:** reciben `CartDraft` de `src/contracts/decision.ts`.
- **UX/UI:** consume `AuditEvent[]` de `src/contracts/audit.ts`.
