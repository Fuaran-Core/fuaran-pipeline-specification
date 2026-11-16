# Decisions

Each entry is a decision this specification rests on, with what it chose, what it declined and why. A
later reader who disagrees should be able to find the argument here and answer it.

## 2026-11-16 — D1: the format is the bytes the first implementation already writes, written down

**Chosen.** The text states the canonical encoding a conformant implementation (Appendix B of the
text) has emitted for every pipeline it has saved: members sorted by UTF-16 code unit in every object,
absence by omission, `$type`-tagged steps, expressions and cells, the family's canonical float layout,
64-bit seeds as strings. The corpus is generated from that implementation's wire-surface harness.

**Declined.** A second design — declaration-ordered records, `null` for absence, sign-prefixed 64-bit
integers — on the model of the model-execution wire specification. It would read more like that
sibling format, and it would re-key every pipeline already hashed. The pipeline's bytes were already
an identity before this text existed; a specification that moved them would be the migration it
exists to prevent. The two formats are different, and §3.2 and Appendix A of the text say where.

## 2026-11-16 — D2: implementations find the corpus by path, under the directory name `Fuaran-Pipeline-Specification`

**Chosen.** A certifying implementation reads the corpus from a checkout of this repository under the
directory name `Fuaran-Pipeline-Specification`, beside its own checkout, or from the path the
environment variable `FUARAN_PIPELINE_SPEC` names (the repository root, which holds `wire-fixtures/`).
**The directory name is the interface**, not the repository name: an implementation hard-codes it,
and renaming it breaks every certifying build at once. It changes only by a recorded decision here,
with every implementation's lookup in the same change-set.

A certifying implementation **fails** when the corpus is absent, naming the paths it tried and the
clone command. It never skips: a gate that is green over nothing reads exactly like a gate that is
green over everything.

## 2026-11-16 — D3: `compute-pipeline-sha256-v1` — a content address over the canonical bytes, its identifier naming the format major

**Chosen.** The pipeline hash is `sha256:` and the lowercase hex SHA-256 of the canonical document's
UTF-8 bytes (§7.1). A pipeline with no canonical bytes — a non-finite real, an ill-formed string, a
repeated member — is refused, never hashed through a substitute. The identifier names the format
major: a change that moves any existing document's bytes mints under `-v2`, and a `-v1` hash stays
valid and distinguishable, because the identifier travels beside it (§7.4). Re-minting an old pipeline
under a newer format is a recorded act.

**Declined.** (a) A domain-separated digest (a prefix hashed before the bytes): it would distinguish a
pipeline hash from any other SHA-256 of the same bytes, which the identifier travelling beside the
value already does, and it would differ from the digest the first implementation already keys its
saved incremental state by. (b) Minting under the model-execution specification's
`canonical-json-sha256-v1`: that rule lays out numbers, integers and escapes differently, so it would
be a second identity for the same pipeline (§7.3).

**The hash excludes node ids.** It is computed over the lowered list of steps, which has none, so a
pipeline reached by two edit histories has one hash. The tree form's own content address, which
covers the ids, is a different digest (§7.3) and is specified with the tree form.

## 2026-11-16 — D4: forward coupling — a new kind lands in the codec, the text, the schema, the corpus and the manifest in one change-set

**Chosen.** From this specification's first version on, a new step kind, expression kind or registry
token, and any change to a member, ordering, encoding, refusal class or digest, lands in one
change-set across: this text, `schemas/v1/`, the corpus and `manifest.json` (regenerated, never
hand-edited), the checks in `wire-fixtures/` where they encode a registry, and the codec of every
certifying implementation (§9.5). The first implementation's suite holds its committed copy of this
corpus to its own emission, so a kind it adds without regenerating the corpus fails its build.

**Why.** It is the rule the family's other wires adopted after each learned that a corpus lagging its
emitter certifies nothing. Writing it down before the first new kind arrives is what makes it a rule
rather than a lesson.

## 2026-11-16 — D5: public, Apache-2.0, Compute vocabulary only, enforced by a sweep

**Chosen.** This repository is public and Apache-2.0 from its first commit. Its normative text names
no implementation, product or application (the family's convention 14); the implementation the corpus
is generated from is named once, in the non-normative Appendix B. `run.ps1` sweeps every file the
repository would publish for names outside Compute's vocabulary and fails on a hit. Examples are
generic: an `amount`, a `region`, a `price`.

## 2026-11-16 — D6: what is Core's is cited, not restated

**Chosen.** Two parts of a pipeline document are another specification's: unit text (the Fuaran Core
unit package's grammar and canonical text) and an embedded source's columnar encoding (the tree wire
format specification's embedded `Transform` source sections). The text adopts both by citation,
normatively, and restates only what a pipeline adds. A restatement would be a second copy of a
grammar, and two copies of a grammar drift.

## 2026-11-16 — D7: the lenient spellings an implementation reads are not the format

**Chosen.** The first implementation reads a set of spellings no emitter writes (`avg` for `mean`, a
`col` for a sort key's `column`, and others, listed in Appendix B). They are recorded as
non-normative. A conforming reader need not read them, and the corpus carries no vector for them.
What a reader MUST tolerate is stated normatively (§3.4) and carried by `accept` vectors: member
order, whitespace, unknown members, string escapes, decimal and unit spellings, and the two spellings
of a default.

**Why.** Each lenient spelling admitted into the format is an obligation on every other reader,
forever, in exchange for a convenience to authors of one implementation's input.

## 2026-11-16 — D8: a date or an instant is read only in its canonical text

**Chosen.** A `Date` or `Timestamp` cell whose value is not its one canonical text is refused
(`invalid-value`), where a decimal's non-canonical text is read as the number it names. A decimal
text has one obvious value however it is written; `15/01/2026` has no defined reading, and two
spellings of one day would be two pipelines with two hashes. The first implementation tightened its
reader to this in the change that cut this specification.
