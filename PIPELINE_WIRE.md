# Compute pipeline wire specification

**Format version 1.** The bytes of a Compute pipeline, and the rule that turns those bytes into an
identity, stated so that an implementation can be written from this document and the corpus beside it
without reading anyone's source.

§1–§10 are normative. Appendix A is a checklist; Appendix B is non-normative.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

This specification is a member of a family of wire specifications and follows the family's
conventions ([`SPEC_CONVENTIONS.md`](https://github.com/fuaran-ui/fuaran-ui-specification/blob/main/SPEC_CONVENTIONS.md)).
It states no exception to them.

---

## 1. Scope

A **pipeline** is an ordered list of **steps**. Each step transforms a table: it keeps rows (`filter`),
computes a column (`derive`), aggregates (`groupBy`), joins another source (`join`), fits a model
(`fit`), and so on. Steps read and compute values through **expressions** (§5.2), which read columns,
literal **cells** (§4.1) and named parameters. A pipeline is evaluated by an evaluator against a source
table; it carries no rows of its own except where a step embeds a source (§4.5).

This document states:

- the **canonical encoding** of a pipeline document (§3) and of the values it carries (§4);
- every **step** and **expression** kind of this version, its tag, its members and their types (§5);
- the **exactness class** each kind's result carries (§6);
- the **pipeline hash** — the minting rule `compute-pipeline-sha256-v1` — and how it relates to the
  other digests a reader will meet (§7);
- how the format changes (§8), how an implementation certifies against the corpus (§9), and the refusal
  classes a reader names (§10).

It does **not** state what a step computes beyond what its members mean. Evaluation semantics —
null handling, coercion, ordering, the pinned arithmetic — are a property of an evaluator and are
certified by an evaluator's own law corpus, not by this document. Two documents with the same bytes
are the same pipeline; whether two evaluators answer it the same way is a separate claim.

**Not specified in this version.** Three step and expression kinds are planned and are absent here:
a **sequence** of pipelines run as one step, a reference to a **host** function registered outside
the pipeline, and a **term decomposition** of a fitted model's prediction. Each is added additively
(§8) by the change that adds it to an emitter, under the forward-coupling rule (§9.5); a version-1
reader refuses its tag until then (§10, `unknown-tag`). The pipeline's **tree form** — a pipeline
held as a tree of nodes with ids, edited by operations — is a second shape family this document will
add in a later revision of version 1; its family name `tree` is reserved in the manifest (§9.4).

## 2. Conformance

This specification is **whole-corpus**, not profile-scoped. Every family in the corpus is a facet of
one document, so an implementation that reads one family reads them all, and a partition would make
claims nobody needs.

- A **reader** decodes pipeline documents. It MUST read every document this specification describes
  (§3.4), refuse every document it describes as refused, naming the class (§10), and interpret what it
  reads as §4–§5 state.
- An **emitter** writes pipeline documents. It MUST write the canonical encoding (§3) and only it.
- A **minting** implementation computes the pipeline hash (§7). It MUST mint over the canonical bytes
  and MUST NOT mint a pipeline that has none.

A conforming implementation is all three. A producer that only writes documents MAY claim the
emitter role alone, naming it; it is not counted as a conforming implementation.

## 3. Canonical encoding

A pipeline document is JSON (RFC 8259). Given the same values, every conformant emitter produces the
same bytes, so a digest over those bytes is a stable identity (§7). The rules below are exhaustive.

### 3.1 Rules

1. **No insignificant whitespace.** None between tokens, none at the start or end, no trailing newline.
2. **UTF-8**, no byte-order mark.
3. **Every object's members are ordered by key, ascending by UTF-16 code unit.** This applies to every
   object at every depth. Comparing by code unit, by code point and by UTF-8 byte agree below
   `U+FFFF` and disagree above it; the order is the **code-unit** order everywhere. A `$` (`U+0024`)
   sorts before every letter and digit, so a `$type` or `$param` member is always first.
4. **Absence is structural.** An optional member that carries nothing is **omitted**. `null` never
   appears in a pipeline document.
5. **Strings** escape `"` as `\"`, `\` as `\\`, and every character `U+0000`–`U+001F` as `\u00` and two
   **lowercase** hexadecimal digits — including tab, line feed and carriage return, which are
   `\u0009`, `\u000a`, `\u000d`, never `\t`, `\n`, `\r`. Every other character, `/`, `U+007F` and all
   non-ASCII characters included, is written literally. A string MUST be well-formed UTF-16: an
   unpaired surrogate has no UTF-8 encoding and therefore no canonical bytes.
6. **32-bit integers** are written as JSON integer tokens: decimal digits with no leading zero, a `-`
   for a negative value, no `+`, no fraction and no exponent (`0`, `42`, `-2147483648`). Every
   integer member of this version is a signed 32-bit integer unless §5 says otherwise.
7. **64-bit integers** — the one 64-bit member is a seed (§5.1) — are written as a JSON **string** of
   their decimal digits: an optional `-`, no leading zero, no `+`, and zero written `"0"`, never `"-0"`
   (`"9007199254740993"`, `"-42"`). A 64-bit integer is not exactly representable as a double, and a
   reader whose numbers are doubles would round it silently.
8. **Real numbers** (IEEE-754 binary64) are written in the **canonical float layout**:
   - the digits are the **shortest** decimal digit sequence that reads back as the same double;
   - let `e` be the base-10 exponent of the first significant digit (`x = d₀.d₁d₂… × 10ᵉ`). Where
     `-4 ≤ e ≤ 16` the number is written in **fixed-point**: the digits with the decimal point placed,
     no exponent, and no decimal point at all when the value is an integer (`0.0001`, `123.456`, `2`,
     `10000000000000000`);
   - otherwise in **scientific** notation: the first digit, then `.` and the remaining digits if there
     are any, then an uppercase `E`, an **always-present** sign, and the exponent in at least two digits
     (`1E-05`, `1E+17`, `1E+21`, `5E-324`, `1.7976931348623157E+308`);
   - **negative zero** is written `0`;
   - **NaN and the infinities MUST NOT appear.** A pipeline that carries one has no canonical bytes
     (§7.2).

   A real number with an integral value is written exactly as the integer of rule 6 would be (`2`, not
   `2.0`); the member's type, not the token, says that it is a real.
9. **Booleans** are `true` and `false`.
10. **Arrays** keep the order the emitter produced. Order is data: two documents that differ only in an
    array's order are two pipelines. §5 marks no array as sorted.
11. **Decimals, dates and instants** are strings in their canonical text (§4.1).
12. **No member is repeated** within one object.

### 3.2 Divergences from RFC 8785 (JCS), field by field

This encoding is close to the JSON Canonicalization Scheme and is not it. Every divergence is listed;
there are no others.

| # | JCS | Here | Why |
|---|---|---|---|
| 1 | Numbers in the ECMAScript `Number::toString` layout: lowercase `e`, the exponent unpadded (`1e-7`, `1e+21`), fixed-point for `1e-6 ≤ \|x\| < 1e21`. | The canonical float layout of §3.1 rule 8: uppercase `E`, a signed exponent of at least two digits (`1E-07`, `1E+21`), fixed-point for `-4 ≤ e ≤ 16`. The **digits** are the same shortest round-trip digits. | The layout is the one this family's other wires already pin, so one value has one spelling across them. An implementation that uses an ECMAScript serialiser MUST re-lay the digits (Appendix A). |
| 2 | Every number a double. | 32-bit integers as integer tokens; the 64-bit seed as a string (§3.1 rules 6–7). | A seed past `2⁵³` is not a double. |
| 3 | Control characters as the short escapes `\b`, `\t`, `\n`, `\f`, `\r` where they exist. | Every control character as `\u00xx`, lowercase (§3.1 rule 5). | One spelling per character, with no table of exceptions. |
| 4 | Says nothing about absent members. | Omitted, never `null` (§3.1 rule 4). | A reader that told absent from null could not be written against emitters that disagreed about which to write. |

Member ordering (§3.1 rule 3) is **the same** as JCS: both order by UTF-16 code unit. JCS forbids
NaN and the infinities, and so does this document. An implementation MAY use a JCS library for string
content and member order and MUST NOT use it for numbers.

### 3.3 Tagged objects and reserved members

A step, an expression and a cell are **tagged objects**: their kind is the string value of a `$type`
member, and the rest of their members are the kind's (§4.1, §5). By §3.1 rule 3, `$type` is the first
member. There is no other discriminated form.

A member whose name begins with `$` is reserved to this specification. Two are defined: `$type`, and
`$param`, which marks a parameter slot (§4.2). An emitter MUST NOT write any other.

### 3.4 Reading

A reader is more tolerant than an emitter, exactly here and nowhere else:

- It MUST accept the members of an object **in any order**, and match them by name.
- It MUST accept **insignificant whitespace** between tokens.
- It MUST accept a string spelled with **any JSON escape** for a character (`\/`, `\n`, `é`); the
  value is the character, and re-encoding writes the canonical spelling.
- It MUST **ignore a member it does not recognise** (a `$`-member included), so a member added later
  is additive (§8).
- It MUST accept the non-canonical **decimal** spellings §4.1 lists, the non-canonical **unit**
  spellings §4.3 lists, the spellings of a default §5.1 lists (`stdErrors` `classical`, a reference
  source without `schema`), and a real number written with a
  fraction or an exponent in a layout other than the canonical one (`1.0e-5`); it reads the value, and
  re-encoding writes the canonical text.

It MUST refuse a document that is not JSON, a `null` anywhere, a repeated member, and every other
document §10 classes as refused. A document a reader reads and then re-encodes is the canonical
document of the value it read; the `accept` vectors (§9.1) pin that.

## 4. Values

### 4.1 Cells

A **cell** is one scalar value: a literal in an expression (`lit`), or a function parameter's default
(`define`, §5.1). It is a tagged object.

| `$type` | `value` | Canonical text |
|---|---|---|
| `Null` | *(no member)* | The absent value. |
| `Int` | a 32-bit integer | §3.1 rule 6. |
| `Float` | a real number | §3.1 rule 8. A reader MUST read an integer token as the real of that value. |
| `Bool` | `true` / `false` | |
| `Str` | a string | Any text, the empty string included. |
| `Date` | a string | `YYYY-MM-DD`: a day of the proleptic Gregorian calendar, year `0000`–`9999`. |
| `Timestamp` | a string | `YYYY-MM-DDThh:mm:ssZ`, or with a fraction of one to nine digits and **no trailing zero**, `YYYY-MM-DDThh:mm:ss.FZ`: a UTC instant, seconds `00`–`59`. One instant has one text. |
| `Decimal` | a string | An exact decimal: an optional `-`, the integer digits with no leading zero, and a `.` with fraction digits only when the fraction is non-zero, with no trailing zero — `0`, `12`, `-3.5`, `0.05`. No exponent, no `+`, no separators, and zero is `0`. |

A reader MUST refuse a `Date` or `Timestamp` whose value is not its canonical text (`invalid-value`).
A reader MUST read a `Decimal` value that is a string of decimal digits with an optional `-` and an
optional `.` followed by digits (`012.50`, `-0.0`), and MUST read an integer token as the decimal of
that value; it reads the number named and re-encodes its canonical text. Any other `Decimal` value is
refused (`invalid-value`).

### 4.2 Parameter slots

Some members are **slots**: they hold either a literal of the member's type, written as §3.1 says, or a
**parameter**, the object `{"$param":"<name>"}`. A parameter is bound to a value by the caller of the
evaluator; the pipeline names it and nothing else. A literal slot is byte-identical to the member it
would be if it were not a slot.

| Slot type | Literal | Members that are slots |
|---|---|---|
| 32-bit integer | §3.1 rule 6 | `limit.n`, `limit.offset`, `rounding.scale`, `fit.control.maxIter`, `kmeans.k`, `bootstrap.replicates` |
| real | §3.1 rule 8 | `fit.control.tol`, `fit.ridge`, `predict.interval.level` |
| string | a string | the `column` of a `sort` key |
| 64-bit integer | §3.1 rule 7 | `kmeans.seed`, `bootstrap.seed` |
| cell | a cell (§4.1) | a `define` parameter's `default` |

A parameter's `$param` MUST be a string (`wrong-type`). An object in a slot without `$param` is refused
(`wrong-type`).

### 4.3 Unit text

Where a value states a unit — a `convert` expression's target, and an embedded source's field — the
unit is **unit text**: the canonical text of a unit under the unit grammar and vocabulary of the
Fuaran Core unit package,
[`docs/units.md`](https://github.com/Fuaran-Core/fuaran-core/blob/main/docs/units.md) ("The admitted
subset", "The canonical text"), which this document adopts normatively. The grammar is UCUM's
case-sensitive syntax over a stated vocabulary; `m`, `km/h`, `kg.m/s2`, `mg/dL` and `1` are unit texts.
Two unit texts name the same unit exactly when they are byte-identical. An emitter writes the
canonical text. A reader MUST read any spelling the grammar parses (`s-1`, `m.kg`, `kg/(m.s2)`), as the
unit it names, and re-encoding writes that unit's canonical text (`/s`, `kg.m`, `kg/m/s2`); a value
the grammar does not parse, or that names a unit outside the vocabulary, is refused (`invalid-value`).

### 4.4 Column types

A column's type is one of these tags, written as a string: `int`, `float`, `bool`, `string`, `date`,
`timestamp`, `decimal`, `timestamp_ms`, `timestamp_us`, `timestamp_ns` (the last three are instants
held at millisecond, microsecond and nanosecond resolution; `timestamp` is seconds). The tags are a
`cast` expression's target (§5.2) and an embedded source's field types (§4.5).

### 4.5 Sources

A **source** is the second table of a `join`, `union`, `intersect` or `except` step, and the model a
`predict` step reads (§5.1). It is one of two shapes:

- **By reference**: `{"ref":"<name>","schema":[]}`. The evaluator resolves the name; the document
  carries no rows. The `schema` member is always written, and always empty. A reader MUST read a
  reference with or without it.
- **Embedded**: `{"columns":{…},"schema":[…]}`, the rows inline in the columnar encoding of the Fuaran
  Core column package. `schema` lists one field per column in column order — `name`, `type` (§4.4),
  and optionally `unit` (§4.3), `label`, `description` and `ext` (a map of string to string) — and
  `columns` maps each column's name to `{"validity":[…],"values":[…]}`, one boolean and one value per
  row. That encoding is specified, member by member, in the tree wire format specification §3.6.25 to
  §3.6.28 ([`WIRE_FORMAT.md`](https://github.com/fuaran-ui/fuaran-ui-specification/blob/main/WIRE_FORMAT.md)),
  which this document adopts normatively for the embedded form, under §3's canonical rules.

An embedded source's rows are part of the pipeline's bytes, and so of its hash (§7.3).

## 5. The pipeline document

A pipeline document is a JSON **array of steps**, in evaluation order. The empty array is a pipeline:
the one that changes nothing.

In the tables below, a member is **required** unless marked *optional*; an optional member is omitted
when it carries nothing (§3.1 rule 4). `expr` is an expression (§5.2); `names` is an array of strings;
`pair` is the object `{"a":<string>,"b":<string>}`; `slot<T>` is a slot (§4.2). Members are listed in
canonical order.

### 5.1 Steps

| `$type` | Members | Meaning |
|---|---|---|
| `filter` | `pred`: expr | Keep the rows where `pred` is true. |
| `project` | `columns`: array of pair | Keep and rename columns: `a` is the source column, `b` its output name, in output order. |
| `derive` | `expr`: expr; `name`: string | A computed column `name`, replacing a column of that name. |
| `groupBy` | `aggs`: array of agg; `keys`: names | One row per group of `keys`, with the aggregates. An **agg** is `{"fn":<aggregate>,"name":<string>,"of":<string>}`: output column `name`, the aggregate `fn` of column `of`. |
| `join` | `how`: join kind; `on`: array of pair; `source`: source | Join the source: `a` is a column of the pipeline's table, `b` of the source. |
| `window` | `as`: string; `fn`: window function; `n`: integer, *optional*; `of`: string; `orderBy`: array of order key; `partitionBy`: names | A window column `as`, the function `fn` over `of`, per partition, in the frame order. `n` is the bucket count, written exactly when `fn` is `ntile`, and required then. An **order key** is `{"column":<string>,"dir":<direction>}`. |
| `pivot` | `agg`: aggregate; `index`: names; `on`: string; `values`: string | Long to wide: one column per value of `on`, the aggregate of `values`, per `index`. |
| `unpivot` | `idVars`: names; `valueVars`: names | Wide to long: melt `valueVars` into variable/value rows, keeping `idVars`. |
| `sort` | `by`: array of sort key | Order the rows. A **sort key** is `{"column":slot<string>,"dir":<direction>}`. |
| `distinct` | *(none)* | Drop repeated rows. |
| `limit` | `n`: slot<int32>; `offset`: slot<int32> | `n` rows after skipping `offset`. |
| `union` | `source`: source | Append the source's rows. |
| `intersect` | `source`: source | Keep the rows that also appear in the source, with multiplicity. |
| `except` | `source`: source | Keep the rows that do not appear in the source, with multiplicity. |
| `define` | `body`: expr; `name`: string; `params`: array of parameter | A named function, for the whole pipeline: every `invoke` of `name` (§5.2) stands for `body` with its parameters bound. A **parameter** is `{"default":slot<cell>?,"name":<string>}`, `default` optional. The step changes no table. |
| `fit` | *the fit members, below* | Fit a regression per group. |
| `predict` | `fit`: object of the fit members; `interval`: object, *optional*; `model`: object; `scale`: `link` \| `response` | Score rows against a fitted model. `model` is `{"from":"training"\|"coefficients","source":<source>}`; `interval` is `{"kind":"confidence"\|"prediction","level":slot<real>}`. |
| `kmeans` | `features`: array of named expr; `groupBy`: names; `k`: slot<int32>; `maxIterations`: integer; `output`: `assignments` \| `centres` \| `summary`; `restarts`: integer; `seed`: slot<int64>; `silhouette`: boolean; `standardise`: boolean | Cluster rows by k-means, per group, seeded. A **named expr** is `{"expr":<expr>,"name":<string>}`. |
| `bootstrap` | `aggregates`: array of agg; `cluster`: string, *optional*; `groupBy`: names; `level`: real, *optional*; `output`: `replicates` \| `summary`; `replicates`: slot<int32>; `seed`: slot<int64> | Resample rows with replacement, per group and replicate, seeded; `cluster` resamples whole clusters. |

**The fit members**, which a `fit` step carries beside its `$type` and a `predict` step carries in its
`fit` object without one:

| Member | Type | |
|---|---|---|
| `control` | `{"maxIter":slot<int32>,"tol":slot<real>}` | The iteration bound and tolerance. |
| `family` | fit family | |
| `groupBy` | names | One fit per group. |
| `intercept` | boolean | |
| `link` | fit link | The pair (`family`, `link`) MUST be admitted (§5.3), else `invalid-value`. |
| `offset` | expr, *optional* | |
| `output` | `coefficients` \| `summary` \| `fitted` \| `residuals` | The table the step answers. |
| `power` | real | Required with, and written only with, the `tweedie` family. |
| `predictors` | array of named expr | |
| `response` | string | |
| `ridge` | slot<real>, *optional* | |
| `stdErrors` | `hc0` \| `hc1` \| `hc2` \| `hc3`, *optional* | A sandwich variant. Omitted means classical standard errors; a reader MUST read `classical` as the same. |
| `theta` | real, *optional* | Read, and written, only with the `negativeBinomial` family: a fixed θ. Omitted, θ is estimated. |
| `weights` | string, *optional* | |

### 5.2 Expressions

| `$type` | Members | Meaning |
|---|---|---|
| `col` | `name`: string | A column's value. |
| `lit` | `cell`: cell | A literal (§4.1). |
| `param` | `name`: string | A parameter's value. |
| `binary` | `left`: expr; `op`: binary operator; `right`: expr | |
| `not` | `expr`: expr | |
| `coalesce` | `exprs`: array of expr | The first non-null. |
| `case` | `cases`: array of `{"then":<expr>,"when":<expr>}`; `else`: expr | |
| `cast` | `expr`: expr; `type`: column type (§4.4) | |
| `apply` | `args`: array of expr; `fn`: scalar function | |
| `in` | `expr`: expr; and exactly one of `items`: array of expr, or `param`: string | Membership in a list, or in a list-valued parameter. |
| `isNull` | `expr`: expr | |
| `now` | `grain`: `date` \| `timestamp` | The evaluation clock, at a grain. |
| `quotient` | `dividend`: expr; `divisor`: expr; `rounding`: rounding | An exact decimal quotient under a stated rounding. A **rounding** is `{"mode":<rounding mode>,"scale":slot<int32>}`. |
| `rounded` | `expr`: expr; `rounding`: rounding | |
| `convert` | `expr`: expr; `unit`: unit text (§4.3) | The value in another unit of the same dimension. |
| `arg` | `name`: string | A `define` parameter, inside its body. |
| `invoke` | `args`: array of expr; `name`: string | A call of a function a `define` step names. |
| `interpolate` | `expr`: expr; `kind`: `linear` \| `step` \| `monotoneCubic`; `knots`: array of `[x, y]`; `outside`: `clamp` \| `null` | A curve through the knots, each a two-element array of reals, in the given order. |

### 5.3 Registries

Each token below is a string. A reader MUST refuse a token outside its registry (`unknown-tag`).

| Registry | Tokens |
|---|---|
| step kind (§5.1) | `filter` `project` `derive` `groupBy` `join` `window` `pivot` `unpivot` `sort` `distinct` `limit` `union` `intersect` `except` `define` `fit` `predict` `kmeans` `bootstrap` |
| expression kind (§5.2) | `col` `lit` `param` `binary` `not` `coalesce` `case` `cast` `apply` `in` `isNull` `now` `quotient` `rounded` `convert` `arg` `invoke` `interpolate` |
| cell kind (§4.1) | `Null` `Int` `Float` `Bool` `Str` `Date` `Timestamp` `Decimal` |
| aggregate | `sum` `mean` `min` `max` `count` `median` `stddev` `first` `last` `countDistinct` |
| join kind | `inner` `left` `right` `outer` `semi` `anti` |
| window function | `rowNumber` `rank` `lag` `lead` `cumulSum` `rollingMean` `denseRank` `competitionRank` `ntile` `cumulMax` `cumulMin` `rollingSum` |
| direction | `asc` `desc` |
| binary operator | `add` `sub` `mul` `div` `mod` `eq` `ne` `lt` `le` `gt` `ge` `and` `or` `contains` `startsWith` `endsWith` |
| scalar function | `abs` `round` `floor` `ceil` `length` `lower` `upper` `substr` `datePart` `concat` `trim` `replace` `dateDiffDays` `sqrt` `least` `greatest` `indexOf` `pow` `exp` `ln` `log10` |
| rounding mode | `half-even` `half-up` `half-down` `up` `down` `ceiling` `floor` |
| fit family | `gaussian` `poisson` `gamma` `tweedie` `quasiPoisson` `binomial` `quasiBinomial` `inverseGaussian` `negativeBinomial` |
| fit link | `identity` `log` `logit` `probit` `cloglog` `inverse` `inverseSquare` `sqrt` |

**Admitted family and link pairs.** `gaussian` with `identity`, `log` or `inverse`; `binomial` and
`quasiBinomial` with `logit`, `probit` or `cloglog`; `poisson` and `quasiPoisson` with `log`,
`identity` or `sqrt`; `gamma` with `inverse`, `identity` or `log`; `inverseGaussian` with
`inverseSquare`, `inverse`, `identity` or `log`; `negativeBinomial` with `log`, `sqrt` or `identity`;
`tweedie` with `log`. Any other pair is refused (`invalid-value`).

## 6. Exactness classes

Whether two evaluators answer a pipeline with the same bits is a claim about evaluators, certified by
an evaluator's law corpus. A document still needs to say which claim it can carry, because a pipeline
is only as portable as the least exact value it computes. Every column a pipeline produces has one of
two classes:

- **Pinned.** Every conformant evaluator computes the same bits.
- **Host-rounded.** Two evaluators agree within a stated ulp bound, not bit for bit. Within one
  evaluator a host-rounded value is as deterministic as any other.

**Every step and expression kind of this version is pinned.** A result is host-rounded only when a
host-rounded value is in its lineage, and in this version such a value enters only through an **input
column** the caller declares host-rounded; no kind here produces one. The planned host-function kind
(§1) will be the first that does. The rule for portability follows: a pipeline is portable — two
conformant evaluators answer it alike — when it uses no host-function kind and reads no column
declared host-rounded; where it does, it is portable only between evaluators that both register
every host function it references, and within the bound those functions state.

## 7. Identity

### 7.1 The pipeline hash — `compute-pipeline-sha256-v1`

The **pipeline hash** is a content address over a pipeline's canonical bytes.

1. **Encode** the pipeline as its canonical document (§3, §5): the array of its steps.
2. **Digest** the document's UTF-8 bytes with SHA-256.
3. **Write** the content address: `sha256:` followed by the 64 **lowercase** hexadecimal digits of
   the digest. The algorithm is named inside the value, so a later digest is a visible discontinuity,
   never a silent one.

The rule's identifier is **`compute-pipeline-sha256-v1`**. Where a pipeline hash travels, the
identifier SHOULD travel beside it (for example as a `specHashAlgorithm`, §7.3).

What the hash covers, and what it does not:

- **Every member of every step, in step order.** Step order is data.
- **Not the authoring order of an object's members**, which the canonical order erases: two documents
  whose members were written in different orders are one pipeline with one hash (the
  `pipeline/accept-member-order` vector).
- **Not the history of the pipeline.** A pipeline is hashed as the list of steps it is, never as the
  sequence of edits that produced it. In particular, the tree form's node ids (§1) are not part of the
  list and are not hashed: two edit histories that arrive at the same list mint one hash.
- **A source by reference contributes its name, not its rows**; an embedded source contributes its
  rows (§4.5).

### 7.2 What has no hash

An emitter MUST NOT mint a pipeline that has no canonical bytes:

- a real number that is NaN or infinite (§3.1 rule 8);
- a string that is not well-formed UTF-16 (§3.1 rule 5);
- a repeated member (§3.1 rule 12).

Each would let two different values share bytes, or produce bytes that do not read back. The
implementation reports the refusal instead; it never substitutes a value and hashes that.

### 7.3 The other digests a reader will meet

Four digests sit near a pipeline. They are different things, and conflating two of them is the most
consequential error available, because each is what a join between independent records rests on.

| Digest | Over what | It is not |
|---|---|---|
| The **pipeline hash** (§7.1) | The canonical bytes of the lowered list of steps. | A hash of the tree form, of the data, or of a fit. |
| The **tree form's content address** (reserved, §1) | The pipeline's tree, node ids included. | The pipeline hash: two trees that lower to one list share a pipeline hash and may differ here. |
| A **specification hash** (`specHash`) under the [model-execution wire specification](https://github.com/Fuaran-Data/fuaran-model-execution-spec) §4.2 | Whatever the submitter's minting rule covers. Where a submitter's model specification **is** a pipeline, it MAY mint `specHash` under this rule, carrying `compute-pipeline-sha256-v1` as its `specHashAlgorithm`; the value is then the pipeline hash. | A hash under `canonical-json-sha256-v1` (that specification's §4.5): the two rules lay out numbers, integers and escapes differently, so over the same pipeline they mint different values. Never compare digests minted under different identifiers. |
| The **composite key** of that specification (§4.3) | The join of a specification hash with the data and the method that fitted it. | Any hash of a pipeline: one pipeline fitted to two datasets has one pipeline hash and two composite keys. |

### 7.4 Rotation

The identifier names the **format major**. A change to this format that moves the bytes of any
existing document (§8) mints under a new identifier, `compute-pipeline-sha256-v2`; a hash minted
under `-v1` stays valid and stays distinguishable, because its identifier travels with it. Reading an
old pipeline under a newer format and minting it again is a **recorded act** — the old hash, the new
hash and the format each was minted under — never a silent re-key.

### 7.5 Worked examples

The empty pipeline is the two bytes `[]`:

```
[]
sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945
```

A pipeline of one `distinct` step:

```
[{"$type":"distinct"}]
sha256:a82d75f66b759246871af23ec87fbb425d2c136f262ecc7e601d7b61c0424436
```

Keep the rows whose `amount` exceeds 100, derive `net`, then sort by it descending and by a column
the caller names in the parameter `tieBreak` (the corpus's `pipeline/filter-derive-sort`). Each
object's members are in code-unit order, so `$type` leads, `left` precedes `op` precedes `right`, and
a sort key's `column` precedes its `dir`; the slot is the `$param` object:

```
[{"$type":"filter","pred":{"$type":"binary","left":{"$type":"col","name":"amount"},"op":"gt","right":{"$type":"lit","cell":{"$type":"Int","value":100}}}},{"$type":"derive","expr":{"$type":"binary","left":{"$type":"col","name":"amount"},"op":"sub","right":{"$type":"col","name":"discount"}},"name":"net"},{"$type":"sort","by":[{"column":"net","dir":"desc"},{"column":{"$param":"tieBreak"},"dir":"asc"}]}]
sha256:fd06acbf7e635964c1fe6f3f74185dd1f8f2dedf97d43e075739ee5326cc0a8d
```

The corpus's `pipeline/float-layout` vector carries one real at each boundary of §3.1 rule 8
(`0.0001`, `1E-05`, `10000000000000000`, `1E+17`, the subnormal `5E-324`, the largest finite double),
and `pipeline/kmeans-bootstrap` a seed past `2⁵³` and a negative seed as strings.

## 8. Versioning

`formatVersion` 1 is this document's version. It is distinct from the minting identifier's major
(§7.4) only in name: the two move together.

- **Additive changes do not move it.** A new step or expression kind, a new token in a registry, a new
  optional member, a new refusal class, a new corpus family. A member added after version 1 is a
  **late member**: it is **omitted** when it carries nothing, so every document written before it
  existed keeps exactly its bytes, and its hash. A reader MUST ignore members it does not recognise
  (§3.4).
- **A change to an existing member's meaning, type, presence or order, a renamed tag, or a change to
  the canonical encoding moves the version**, and with it the minting identifier (§7.4). Every such
  change alters bytes a hash was computed over.
- A reader receiving a step or expression kind it does not know refuses the document (`unknown-tag`):
  a pipeline cannot be evaluated around a step it cannot read.

## 9. Certifying against the corpus

The corpus lives in [`wire-fixtures/`](wire-fixtures/). `manifest.json` is the **authoritative
enumeration**: the families, every vector, its kind, its file's SHA-256 and, for a hash or accept
vector, its digest. **Counts live in the manifest, never in prose.**

### 9.1 Vector kinds

| Kind | What certifying means |
|---|---|
| `hash` | Decode the document and re-encode it: the bytes MUST be identical. Then mint the pipeline hash (§7.1): it MUST equal the manifest's `digest`. |
| `round-trip` | Decode and re-encode; the bytes MUST be identical. (No family carries one in this version: every round-trip vector is also a hash vector.) |
| `reject` | The reader MUST refuse the document, for the class the manifest's `reject` names (§10). A refusal for another reason is not a pass. |
| `accept` | The reader MUST NOT refuse the document. Re-encoding what it read MUST give the manifest's `canonical` bytes, and minting MUST give its `digest`. |

### 9.2 Families

| Family | What its vectors reach |
|---|---|
| `pipeline` | Whole pipelines: the worked examples, the encoding's edge cases, and the document-level reject and accept vectors. |
| `step` | One vector per step kind, every optional member present. |
| `expr` | One vector per expression kind. |
| `cell` | One vector per cell kind; the cell texts' reject and accept vectors. |
| `slot` | Each slot type, as a literal and as a parameter. |
| `token` | Every token of every registry, and every column type as a `cast` target. |
| `source` | A source by reference and an embedded one. |

A `hash` vector's `case` member names the kind or token the document was built to reach; it is
informative.

### 9.3 To certify

1. Run every vector in every family. Certifying a subset is not certifying.
2. **Assert that the number of vectors you ran equals the number the manifest enumerates.**
3. **Prove once that a mutated document makes your harness go red.** A green run that exercised
   nothing looks exactly like one that exercised everything.

### 9.4 Reservation

`manifest.json` carries `reservedFamilies`. A name reserved there is a family this specification
intends to add; it is not missing, and an implementation is not failing to run it. `tree` is reserved
for the tree form (§1). Adding it is additive.

### 9.5 Forward coupling

A new step or expression kind, a new token, or a change to any member, ordering, encoding, refusal
class or digest lands **in one change-set** across every artefact it touches:

1. this document;
2. the schema, `schemas/v1/pipeline.schema.json`;
3. the corpus and `manifest.json`, regenerated by the emitter that produces it;
4. the independent checks in `wire-fixtures/`, where they encode a registry or a rule;
5. the codec of every implementation that certifies against the corpus.

Where those live in more than one repository, "one change-set" means the changes land together. A
corpus that lags its emitter certifies nothing, and a specification that lags either is believed.

### 9.6 Two emitters

The corpus is produced by a conformant implementation. [`wire-fixtures/emit.mjs`](wire-fixtures/emit.mjs)
is a second emitter, written from this document alone in another language: it re-derives the
canonical bytes of every `hash` and `accept` document from its parsed value, with every object's
members first put out of order, and mints every digest itself. A divergence between the two is a
defect in this document — a rule missing, or a rule stated that is not the rule being followed —
before it is a defect in either emitter. Reject vectors are not reproduced: reproducing a document
that must be refused shows nothing about it.

### 9.7 Schema

[`schemas/v1/pipeline.schema.json`](schemas/v1/pipeline.schema.json) is a JSON Schema (draft 2020-12)
of what a reader accepts. It is structural and subordinate to this document: it cannot say that
members are ordered, that a hash equals a recomputation, that a date is in the calendar, or that a
family and a link are admitted. [`wire-fixtures/validate.mjs`](wire-fixtures/validate.mjs) runs it
beside the rules no schema can state.

## 10. Refusal classes

A reader that refuses a document names one of these classes. The corpus's reject vectors name the
class each must be refused for.

| Class | The document |
|---|---|
| `not-json` | is not JSON (RFC 8259). |
| `not-a-pipeline` | is JSON, and not an array of steps. |
| `null-member` | carries `null` anywhere (§3.1 rule 4). |
| `repeated-member` | names one member twice in one object (§3.1 rule 12). |
| `missing-member` | lacks a required member, `$type` included. |
| `wrong-type` | carries a member whose JSON type is not the member's: a string where a number is required, a number outside a 32-bit integer's range or with a fraction where an integer is required, a seed as a number, a quoted non-finite token where a real is required, a `$param` that is not a string. |
| `unknown-tag` | carries a `$type`, or a registry token (§5.3), that this version does not define. |
| `invalid-value` | carries a member of the right type whose value is not one: a date, instant, decimal or seed text that is not its type's, a unit text that is not one, a family and link that are not an admitted pair. |

Adding a class for a document that was already refused is additive (§8).

---

## Appendix A — implementation checklist

Ordered by how often each item is the thing that is wrong.

1. **Every object's members sorted by UTF-16 code unit, at every depth** (§3.1 rule 3). Not insertion
   order, not declaration order, and not code-point order above `U+FFFF`.
2. **The float layout** (§3.1 rule 8). An ECMAScript serialiser gives the right digits and the wrong
   layout: uppercase the `e`, pad the exponent to two digits, and move the fixed-point window to
   `-4 ≤ e ≤ 16`. `1e21` is `1E+21`; `1e-7` is `1E-07`; `0.00001` is `1E-05`;
   `1e16` is `10000000000000000`.
3. **Control characters as `\u00xx`, lowercase** (§3.1 rule 5), never `\n` or `\t`; `/` unescaped.
4. **Absent means omitted** (§3.1 rule 4), and a reader refuses `null`.
5. **The seed as a string** (§3.1 rule 7), unsigned when non-negative — unlike a signed 64-bit integer
   elsewhere in this family, which carries an explicit `+`.
6. **A `window` step's `n` only with `ntile`; a fit's `power` only with `tweedie`, `theta` only with
   `negativeBinomial`, `stdErrors` never `classical`.**
7. **The canonical text of a date, an instant and a decimal** (§4.1): no trailing zero in an instant's
   fraction or a decimal's.
8. **Mint over the bytes, refuse what has none** (§7.2).

## Appendix B — non-normative

**The first conformant emitter.** The corpus is generated by the `Fuaran.Compute.DataFrame` package
of the [`fuaran-core-compute`](https://github.com/Fuaran-Core/fuaran-core-compute) repository, whose
codec this document was written from, and whose suite certifies against this corpus as a build input.
Its function `Pipeline.hash` implements §7.1.

**Lenient spellings that implementation reads.** It also reads spellings this document does not
define, for documents written by hand or by a model: `avg` for `mean`; `cumSum` for `cumulSum`; an
agg's `as`, `op` and `column` for `name`, `fn` and `of`; a key's `col` for `column` and `descending`
(a boolean) or `direction` for `dir`, and `asc` where none is given; `groupBy`'s `by` and
`aggregations`; `sort`'s `keys`; `limit`'s `count`, and `0` where `offset` is absent; `project`'s
`cols`; `filter`'s `predicate`, and a flat comparison form; `call` and `fn` for `apply`; the binary
operators as expression kinds of their own; `robust` for `hc3`. They are not part of the format: a
conforming reader need not read them, and no emitter writes them.
