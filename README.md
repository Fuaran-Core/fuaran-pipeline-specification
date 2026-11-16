# Compute pipeline wire specification

A language-neutral, versioned wire specification for a **Compute pipeline**: an ordered list of
dataframe steps — filter, derive, group, join, window, fit, predict, cluster, resample — over
expressions, literal cells and named parameters. It states the canonical bytes of a pipeline document,
every step and expression kind and its members, and **`compute-pipeline-sha256-v1`**, the rule that
turns a pipeline into a content address. An executable conformance corpus certifies all of it.

```
PIPELINE_WIRE.md          the specification. §1–§10 are normative.
schemas/v1/               the JSON Schema of a pipeline document - structural, subordinate to the text.
wire-fixtures/            the conformance corpus. manifest.json is the authoritative enumeration.
run.ps1                   verify: a second emitter, the schema and rule checks, their self-tests,
                          and the publication-boundary sweep.
DECISIONS.md              why the format and this repository are the way they are.
LICENSE / NOTICE          Apache-2.0.
```

## Start here

- **Implementing?** Read §3 (the canonical encoding: this is where the cost is), §4 (values), §5 (the
  steps and expressions) and §7 (the hash). Appendix A is the checklist, ordered by how often each
  item is the thing that is wrong.
- **Certifying?** [`wire-fixtures/README.md`](wire-fixtures/README.md), and §9.
- **Holding a pipeline hash and wondering what it identifies?** §7.1 says what it covers and §7.3 what
  it is not.

## Verify

```powershell
pwsh ./run.ps1
```

Requires Node.js and PowerShell 7; nothing else, and no build step.

## Status

**Format version 1.** Every step and expression kind an implementation emits today is specified and
certifiable. Three kinds are planned and absent (§1): each lands additively, with its text, schema
and vectors, in the change that adds it. The pipeline's tree form is reserved as the family `tree`.

## Where implementations look for this repository

An implementation that certifies against the corpus finds it by **path**: a checkout of this
repository under the directory name **`Fuaran-Pipeline-Specification`**, beside the implementation's
own checkout, or the path an environment variable names. The directory name is an interface; see
`DECISIONS.md` D2.

## Contributing changes

A change to any step, expression, member, ordering, encoding, refusal class or digest updates **this
document, the schema, the corpus and its manifest, the checks in `wire-fixtures/`, and every
certifying implementation's codec in one change-set** (§9.5). Run `pwsh ./run.ps1` before committing.
