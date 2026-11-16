// SPDX-License-Identifier: Apache-2.0
//
// The second emitter (PIPELINE_WIRE.md §9.6). Zero dependencies.
//
//   node emit.mjs              # re-derive every hash document and every digest, compare
//   node emit.mjs --self-test  # prove the comparison goes red
//
// Written from PIPELINE_WIRE.md alone. For every `hash` vector it parses the
// committed document into plain values, puts every object's members OUT of
// order, writes the canonical bytes by §3 and mints the digest by §7.1, and
// compares both with what the corpus committed. For every `accept` vector it
// does the same to the manifest's `canonical` document, which must already be
// canonical and must mint the recorded digest. Reject vectors are not
// reproduced: reproducing a document that must be refused shows nothing.
//
// One number rule serves every number in a pipeline: the canonical float
// layout of §3.1 rule 8. Every integer member is a signed 32-bit integer, and
// over that range the float layout and the integer layout of rule 6 write the
// same text, so a parser that reads every number as a double loses nothing.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const selfTest = process.argv.includes("--self-test");

const IDENTIFIER = "compute-pipeline-sha256-v1";

// ── §3.1 rule 8: the canonical float layout ──────────────────────────

function formatNumber(x) {
  if (!Number.isFinite(x)) throw new Error(`a non-finite number has no canonical text (${x})`);
  if (x === 0) return "0"; // negative zero included
  // ECMAScript gives the shortest round-trip digits; only the layout is ours.
  const [mantissa, exponentText] = Math.abs(x).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const e = Number(exponentText);
  const sign = x < 0 ? "-" : "";
  if (e >= -4 && e <= 16) {
    if (e < 0) return sign + "0." + "0".repeat(-e - 1) + digits;
    if (digits.length <= e + 1) return sign + digits + "0".repeat(e + 1 - digits.length);
    return sign + digits.slice(0, e + 1) + "." + digits.slice(e + 1);
  }
  const m = digits.length === 1 ? digits : digits[0] + "." + digits.slice(1);
  const magnitude = String(Math.abs(e)).padStart(2, "0");
  return sign + m + "E" + (e < 0 ? "-" : "+") + magnitude;
}

// ── §3.1 rule 5: strings ─────────────────────────────────────────────

function formatString(s) {
  let out = '"';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("an unpaired surrogate has no canonical bytes");
      out += s[i] + s[i + 1];
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      throw new Error("an unpaired surrogate has no canonical bytes");
    } else if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c < 0x20) out += "\\u00" + c.toString(16).padStart(2, "0");
    else out += s[i];
  }
  return out + '"';
}

// ── §3.1 rule 3: members by UTF-16 code unit; the whole document ─────

const codeUnitOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // JS compares strings by code unit

function canonical(value) {
  if (value === null) throw new Error("null never appears in a pipeline document");
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  switch (typeof value) {
    case "number":
      return formatNumber(value);
    case "string":
      return formatString(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      const keys = Object.keys(value).sort(codeUnitOrder);
      return "{" + keys.map((k) => formatString(k) + ":" + canonical(value[k])).join(",") + "}";
    }
    default:
      throw new Error(`no canonical text for a ${typeof value}`);
  }
}

/** The same value with every object's members in REVERSED insertion order. */
function disordered(value) {
  if (Array.isArray(value)) return value.map(disordered);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).reverse()) out[k] = disordered(value[k]);
    return out;
  }
  return value;
}

const mint = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");

// ── the comparison ───────────────────────────────────────────────────

/** Compare every derivable document and digest; answers the failures. */
function compare(manifest, readDocument) {
  const failures = [];
  let compared = 0;

  if (manifest.hashAlgorithm !== IDENTIFIER)
    failures.push(`manifest mints under '${manifest.hashAlgorithm}', the text under '${IDENTIFIER}'`);

  for (const v of manifest.vectors) {
    let committed;
    if (v.kind === "hash" || v.kind === "round-trip") committed = readDocument(v.file);
    else if (v.kind === "accept") committed = Buffer.from(v.canonical, "utf8");
    else continue;

    compared += 1;
    let ours;
    try {
      ours = Buffer.from(canonical(disordered(JSON.parse(committed.toString("utf8")))), "utf8");
    } catch (error) {
      failures.push(`${v.id}: ${error.message}`);
      continue;
    }
    if (!ours.equals(committed)) {
      failures.push(`${v.id}: bytes differ\n  committed: ${committed.toString("utf8")}\n  derived:   ${ours.toString("utf8")}`);
      continue;
    }
    if (v.kind !== "round-trip" && mint(ours) !== v.digest)
      failures.push(`${v.id}: digest ${mint(ours)}, the manifest records ${v.digest}`);
  }
  return { failures, compared };
}

const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const fromDisk = (file) => readFileSync(join(here, file));

if (selfTest) {
  let red = 0;
  const expectRed = (what, result) => {
    if (result.failures.length === 0) {
      console.error(`FAIL self-test: ${what} did not go red`);
      red += 1;
    } else console.log(`ok   self-test: ${what} goes red`);
  };

  const hashVector = manifest.vectors.find((v) => v.kind === "hash");
  const others = (map) => ({ ...manifest, vectors: manifest.vectors.map(map) });

  expectRed(
    "a document whose members are out of order",
    compare(others((v) => v), (file) =>
      file === hashVector.file
        ? Buffer.from(canonical(JSON.parse(fromDisk(file).toString("utf8"))).replace(/^\[\{"\$type":"([^"]*)",/, '[{"zz":0,"$type":"$1",'), "utf8")
        : fromDisk(file)));
  expectRed(
    "a digest that is not the document's",
    compare(others((v) => (v.id === hashVector.id ? { ...v, digest: "sha256:" + "0".repeat(64) } : v)), fromDisk));
  expectRed(
    "a float in a layout other than the canonical one",
    compare({ ...manifest, vectors: [{ id: "self-test/float", kind: "round-trip", file: "x" }] }, () =>
      Buffer.from('[{"$type":"filter","pred":{"$type":"lit","cell":{"$type":"Float","value":1e-7}}}]', "utf8")));
  expectRed(
    "a control character in a short escape",
    compare({ ...manifest, vectors: [{ id: "self-test/escape", kind: "round-trip", file: "x" }] }, () =>
      Buffer.from('[{"$type":"derive","expr":{"$type":"lit","cell":{"$type":"Str","value":"a\\nb"}},"name":"t"}]', "utf8")));
  expectRed(
    "a manifest minting under another identifier",
    compare({ ...manifest, hashAlgorithm: "canonical-json-sha256-v1" }, fromDisk));

  if (red > 0) process.exit(1);
  console.log("emit.mjs self-test: every check goes red");
} else {
  const { failures, compared } = compare(manifest, fromDisk);
  for (const f of failures) console.error(`FAIL ${f}`);
  const derivable = manifest.vectors.filter((v) => v.kind !== "reject").length;
  if (compared !== derivable) {
    console.error(`FAIL compared ${compared} documents, the manifest enumerates ${derivable}`);
    process.exit(1);
  }
  if (failures.length > 0) process.exit(1);
  console.log(`emit.mjs: ${compared} documents re-derived byte for byte, every digest minted`);
}
