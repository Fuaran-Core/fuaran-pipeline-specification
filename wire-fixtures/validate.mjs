// SPDX-License-Identifier: Apache-2.0
//
// The corpus's index, schema and rule checker — the layer beneath emit.mjs's
// byte comparison (PIPELINE_WIRE.md §9.7). Zero dependencies.
//
//   node validate.mjs              # check the corpus
//   node validate.mjs --self-test  # prove each check goes red
//
// It answers four questions the byte comparison cannot:
//
//   1. Index integrity — is every file on disk in the manifest, does every
//      entry point at a file that exists, does every recorded sha256 match the
//      bytes, and is every entry well-formed for its kind?
//   2. Structure — does every document a reader must read (each hash and
//      accept document, and each accept vector's canonical form) validate
//      against schemas/v1/pipeline.schema.json?
//   3. Rules — what §4 and §5 require that no schema can say: a date in the
//      calendar, an instant's and a decimal's canonical text in a canonical
//      document, unit text, an admitted family and link, `n` exactly with
//      `ntile`, `power` exactly with `tweedie`, `theta` only with
//      `negativeBinomial`, a seed in range, two coordinates per knot, no
//      repeated member.
//   4. Rejection — does every reject vector actually FAIL, by the means its
//      `detect` names (the schema, or a rule)? A reject vector that quietly
//      passes reports a check that is not happening.
//
// The JSON Schema support is a deliberately small SUBSET, and the script
// REFUSES a schema using a keyword it does not implement rather than ignoring
// it: an unimplemented keyword is exactly how a validator looks green.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const selfTest = process.argv.includes("--self-test");

// ── a strict JSON reader: refuses a repeated member, and never yields null silently ──

function parseStrict(text) {
  let pos = 0;
  const fail = (why) => {
    throw new Error(`${why} at ${pos}`);
  };
  const ws = () => {
    while (pos < text.length && " \t\n\r".includes(text[pos])) pos += 1;
  };
  const value = () => {
    ws();
    const c = text[pos];
    if (c === "{") {
      pos += 1;
      const out = {};
      const seen = new Set();
      ws();
      if (text[pos] === "}") {
        pos += 1;
        return out;
      }
      for (;;) {
        ws();
        if (text[pos] !== '"') fail("expected a member name");
        const key = string();
        if (seen.has(key)) throw new Error(`repeated member '${key}'`);
        seen.add(key);
        ws();
        if (text[pos] !== ":") fail("expected ':'");
        pos += 1;
        out[key] = value();
        ws();
        if (text[pos] === ",") pos += 1;
        else if (text[pos] === "}") {
          pos += 1;
          return out;
        } else fail("expected ',' or '}'");
      }
    }
    if (c === "[") {
      pos += 1;
      const out = [];
      ws();
      if (text[pos] === "]") {
        pos += 1;
        return out;
      }
      for (;;) {
        out.push(value());
        ws();
        if (text[pos] === ",") pos += 1;
        else if (text[pos] === "]") {
          pos += 1;
          return out;
        } else fail("expected ',' or ']'");
      }
    }
    if (c === '"') return string();
    const m = /^(-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?|true|false|null)/.exec(text.slice(pos));
    if (!m) fail("not a JSON value");
    pos += m[0].length;
    return m[0] === "true" ? true : m[0] === "false" ? false : m[0] === "null" ? null : Number(m[0]);
  };
  const string = () => {
    const m = /^"(?:[^"\\\u0000-\u001f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/.exec(text.slice(pos));
    if (!m) fail("not a JSON string");
    pos += m[0].length;
    return JSON.parse(m[0]);
  };
  const v = value();
  ws();
  if (pos !== text.length) fail("trailing text");
  return v;
}

// ── a deliberately small JSON Schema subset ──────────────────────────

const SUPPORTED = new Set([
  "$schema", "$ref", "$comment", "$defs", "title", "type", "const", "enum", "pattern", "minLength",
  "minimum", "maximum", "minItems", "items", "properties", "required", "additionalProperties", "oneOf",
]);

const schemaFile = resolve(here, "..", "schemas", "v1", "pipeline.schema.json");
const rootSchema = JSON.parse(readFileSync(schemaFile, "utf8"));

function auditKeywords(node, path, out) {
  if (Array.isArray(node)) return node.forEach((item, i) => auditKeywords(item, `${path}[${i}]`, out));
  if (node === null || typeof node !== "object") return;
  for (const key of Object.keys(node)) {
    if (path.endsWith("/properties") || path.endsWith("/$defs")) {
      auditKeywords(node[key], `${path}/${key}`, out);
      continue;
    }
    if (!SUPPORTED.has(key)) out.push(`the schema uses unimplemented keyword '${key}' at ${path}`);
    else auditKeywords(node[key], `${path}/${key}`, out);
  }
}

function deref(ref) {
  let node = rootSchema;
  for (const segment of ref.replace(/^#/, "").split("/").slice(1)) {
    node = node[segment];
    if (node === undefined) throw new Error(`unresolvable $ref '${ref}'`);
  }
  return node;
}

const typeOf = (v) =>
  v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v === "number" ? "number" : typeof v;

function validate(value, schema, at = "") {
  if (schema.$ref) return validate(value, deref(schema.$ref), at);
  const bad = [];
  const kind = typeOf(value);
  const where = at || "/";
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => t === kind || (t === "number" && kind === "integer")))
      bad.push(`${where}: expected ${types.join("|")}, got ${kind}`);
  }
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const))
    bad.push(`${where}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
    bad.push(`${where}: ${JSON.stringify(value)} is not one of the registry`);
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern, "u").test(value))
    bad.push(`${where}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  if (schema.minLength !== undefined && typeof value === "string" && value.length < schema.minLength)
    bad.push(`${where}: shorter than ${schema.minLength}`);
  if (schema.minimum !== undefined && typeof value === "number" && value < schema.minimum)
    bad.push(`${where}: ${value} < ${schema.minimum}`);
  if (schema.maximum !== undefined && typeof value === "number" && value > schema.maximum)
    bad.push(`${where}: ${value} > ${schema.maximum}`);
  if (schema.minItems !== undefined && Array.isArray(value) && value.length < schema.minItems)
    bad.push(`${where}: fewer than ${schema.minItems} items`);
  if (schema.items && Array.isArray(value)) value.forEach((x, i) => bad.push(...validate(x, schema.items, `${at}[${i}]`)));
  if (kind === "object") {
    for (const key of schema.required ?? []) if (!(key in value)) bad.push(`${where}: missing required member '${key}'`);
    for (const [key, member] of Object.entries(value)) {
      const property = schema.properties?.[key];
      if (property) bad.push(...validate(member, property, `${at}.${key}`));
      else if (typeof schema.additionalProperties === "object")
        bad.push(...validate(member, schema.additionalProperties, `${at}.${key}`));
    }
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s) => validate(value, s, at).length === 0).length;
    if (matches !== 1) bad.push(`${where}: matched ${matches} of ${schema.oneOf.length} alternatives`);
  }
  return bad;
}

// ── §4.3 unit text, written from the unit vocabulary the text adopts ──

const UNIT_ATOMS = new Map([
  ...["m", "g", "s", "A", "K", "mol", "cd", "rad", "sr", "Hz", "N", "Pa", "J", "W", "C", "V", "F", "Ohm", "S", "Wb", "T", "H", "lm", "lx", "Bq", "Gy", "Sv", "kat", "L", "t", "bar"].map((a) => [a, true]),
  ...["min", "h", "d", "wk", "a", "%", "[ppm]", "[ppb]", "[in_i]", "[ft_i]", "[yd_i]", "[mi_i]", "[lb_av]", "[oz_av]"].map((a) => [a, false]),
]);
const UNIT_ALIASES = new Map([["l", "L"]]);
const UNIT_PREFIXES = ["da", "Y", "Z", "E", "P", "T", "G", "M", "k", "h", "d", "c", "m", "u", "n", "p", "f", "a", "z", "y"];
const NOT_CURRENCIES = new Set(["[CFU]", "[PFU]", "[FFU]", "[BAU]", "[PNU]", "[FEU]", "[ELU]"]);

function unitAtom(token) {
  const whole = UNIT_ALIASES.get(token) ?? token;
  if (UNIT_ATOMS.has(whole)) return [whole, ""];
  if (/^\[[A-Z]{3}\]$/.test(token) && !NOT_CURRENCIES.has(token)) return [token, ""];
  for (const prefix of UNIT_PREFIXES) {
    if (!token.startsWith(prefix) || token.length === prefix.length) continue;
    const rest = UNIT_ALIASES.get(token.slice(prefix.length)) ?? token.slice(prefix.length);
    const metric = UNIT_ATOMS.has(rest) ? UNIT_ATOMS.get(rest) : /^\[[A-Z]{3}\]$/.test(rest) && !NOT_CURRENCIES.has(rest);
    if (metric) return [rest, prefix];
    if (UNIT_ATOMS.has(rest)) return null;
  }
  return null;
}

function parseUnit(text) {
  let pos = 0;
  const add = (into, key, e) => into.set(key, (into.get(key) ?? 0) + e);
  const term = (closing) => {
    const acc = new Map();
    let sign = 1;
    if (text[pos] === "/") {
      sign = -1;
      pos += 1;
    }
    for (;;) {
      for (const [k, e] of component()) add(acc, k, sign * e);
      if (pos === text.length || text[pos] === closing) return acc;
      if (text[pos] === ".") sign = 1;
      else if (text[pos] === "/") sign = -1;
      else throw new Error(`unexpected '${text[pos]}' at ${pos}`);
      pos += 1;
    }
  };
  const component = () => {
    if (text[pos] === "(") {
      pos += 1;
      const inner = term(")");
      if (text[pos] !== ")") throw new Error(`unclosed '(' at ${pos}`);
      pos += 1;
      return inner;
    }
    if (/[0-9]/.test(text[pos] ?? "")) {
      const start = pos;
      while (/[0-9*^]/.test(text[pos] ?? "")) pos += 1;
      if (text.slice(start, pos) !== "1") throw new Error(`a numeric factor at ${start}`);
      return new Map();
    }
    const start = pos;
    while (pos < text.length) {
      if (text[pos] === "[") {
        const close = text.indexOf("]", pos);
        if (close < 0) throw new Error(`unclosed '[' at ${pos}`);
        pos = close + 1;
      } else if (/[A-Za-z%]/.test(text[pos])) pos += 1;
      else break;
    }
    const token = text.slice(start, pos);
    if (token === "") throw new Error(`expected a unit at ${pos}`);
    const atom = unitAtom(token);
    if (!atom) throw new Error(`'${token}' is not an admitted unit`);
    const expStart = pos;
    if (text[pos] === "+" || text[pos] === "-") pos += 1;
    const digitsStart = pos;
    while (/[0-9]/.test(text[pos] ?? "")) pos += 1;
    let e = 1;
    if (pos > expStart) {
      if (pos === digitsStart) throw new Error(`a sign with no exponent at ${expStart}`);
      e = Number(text.slice(expStart, pos));
    }
    return new Map(e === 0 ? [] : [[atom[0] + "|" + atom[1], e]]);
  };
  if (text.length === 0) throw new Error("empty");
  const factors = new Map();
  for (const [k, e] of term(undefined)) add(factors, k, e);
  if (pos !== text.length) throw new Error(`unexpected '${text[pos]}' at ${pos}`);
  return factors;
}

const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function renderUnit(factors) {
  const ordered = [...factors]
    .filter(([, e]) => e !== 0)
    .map(([k, e]) => [...k.split("|"), e])
    .sort((a, b) => ordinal(a[0], b[0]) || ordinal(a[1], b[1]));
  const text = ([symbol, prefix, e]) => prefix + symbol + (Math.abs(e) === 1 ? "" : String(Math.abs(e)));
  const up = ordered.filter(([, , e]) => e > 0).map(text);
  const down = ordered.filter(([, , e]) => e < 0).map(text);
  return up.length === 0 && down.length === 0 ? "1" : up.join(".") + down.map((t) => "/" + t).join("");
}

/** Why a unit text breaks §4.3 (canonical: it must also be the canonical text), or null. */
function unitViolation(text, canonical) {
  let factors;
  try {
    factors = parseUnit(text);
  } catch (error) {
    return `'${text}' is not unit text: ${error.message}`;
  }
  const c = renderUnit(factors);
  return canonical && c !== text ? `'${text}' is not canonical unit text ('${c}')` : null;
}

// ── §4–§5 rules no schema can state ──────────────────────────────────

const ADMITTED = {
  gaussian: ["identity", "log", "inverse"],
  binomial: ["logit", "probit", "cloglog"],
  quasiBinomial: ["logit", "probit", "cloglog"],
  poisson: ["log", "identity", "sqrt"],
  quasiPoisson: ["log", "identity", "sqrt"],
  gamma: ["inverse", "identity", "log"],
  inverseGaussian: ["inverseSquare", "inverse", "identity", "log"],
  negativeBinomial: ["log", "sqrt", "identity"],
  tweedie: ["log"],
};

function dateViolation(text) {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(text);
  if (!m) return `'${text}' is not a date's canonical text`;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= days ? null : `'${text}' is not a day of the calendar`;
}

function instantViolation(text) {
  const m = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{0,8}[1-9])?Z$/.exec(text);
  if (!m) return `'${text}' is not an instant's canonical text`;
  if (Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 59) return `'${text}' is not a time of day`;
  return dateViolation(m[1]);
}

const CANONICAL_DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/;

function seedViolation(text) {
  if (typeof text !== "string") return null;
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  if (!/^(0|[1-9][0-9]*)$/.test(digits) || (negative && digits === "0")) return `seed '${text}' is not its canonical text`;
  const limit = negative ? "9223372036854775808" : "9223372036854775807";
  return digits.length < 19 || (digits.length === 19 && digits <= limit) ? null : `seed '${text}' is outside the signed 64-bit range`;
}

/** Every rule violation in a parsed document. `canonical`: the document must be a canonical one. */
function ruleViolations(doc, canonical) {
  const bad = [];
  const walk = (v, at) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
    if (v === null || typeof v !== "object") return;
    const t = v.$type;
    if (t === "Date" && typeof v.value === "string") {
      const why = dateViolation(v.value);
      if (why) bad.push(`${at}: ${why}`);
    }
    if (t === "Timestamp" && typeof v.value === "string") {
      const why = instantViolation(v.value);
      if (why) bad.push(`${at}: ${why}`);
    }
    if (canonical && t === "Decimal" && !(typeof v.value === "string" && CANONICAL_DECIMAL.test(v.value) && v.value !== "-0"))
      bad.push(`${at}: decimal ${JSON.stringify(v.value)} is not its canonical text`);
    if (t === "convert" && typeof v.unit === "string") {
      const why = unitViolation(v.unit, canonical);
      if (why) bad.push(`${at}: ${why}`);
    }
    if (Array.isArray(v.schema))
      for (const f of v.schema)
        if (f && typeof f.unit === "string") {
          const why = unitViolation(f.unit, canonical);
          if (why) bad.push(`${at}.schema: ${why}`);
        }
    if ("family" in v && "link" in v && typeof v.family === "string") {
      if (!(ADMITTED[v.family] ?? []).includes(v.link)) bad.push(`${at}: the family ${v.family} and the link ${v.link} are not an admitted pair`);
      if ((v.family === "tweedie") !== ("power" in v)) bad.push(`${at}: 'power' is required with, and only with, the tweedie family`);
      if ("theta" in v && v.family !== "negativeBinomial") bad.push(`${at}: 'theta' is read only with the negativeBinomial family`);
      if (canonical && v.stdErrors === "classical") bad.push(`${at}: canonical form omits classical standard errors`);
    }
    if (t === "window" && (v.fn === "ntile") !== ("n" in v)) bad.push(`${at}: 'n' is required with, and only with, ntile`);
    if (t === "kmeans" || t === "bootstrap") {
      const why = seedViolation(v.seed);
      if (why) bad.push(`${at}: ${why}`);
    }
    if (t === "interpolate" && Array.isArray(v.knots) && v.knots.some((k) => !Array.isArray(k) || k.length !== 2))
      bad.push(`${at}: a knot is two coordinates`);
    if (canonical && "ref" in v && !Array.isArray(v.schema)) bad.push(`${at}: canonical form writes a reference's empty schema`);
    for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  walk(doc, "");
  return bad;
}

// ── the checks, over (manifest, files) so the self-test can run them on mutated copies ──

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const KINDS = new Set(["hash", "round-trip", "reject", "accept"]);
const CLASSES = new Set(["not-json", "not-a-pipeline", "null-member", "repeated-member", "missing-member", "wrong-type", "unknown-tag", "invalid-value"]);

function check(manifest, files) {
  const failures = [];
  let documents = 0;
  const fail = (m) => failures.push(m);

  // 1. index integrity
  if (manifest.specification !== "compute-pipeline-wire") fail("manifest: not this specification's corpus");
  if (manifest.formatVersion !== 1) fail("manifest: a format version this text does not define");
  if (!Array.isArray(manifest.reservedFamilies)) fail("manifest: reservedFamilies must be present, even empty");
  const ids = new Set();
  const enumerated = new Set();
  for (const v of manifest.vectors) {
    if (ids.has(v.id)) fail(`${v.id}: enumerated twice`);
    ids.add(v.id);
    enumerated.add(v.file);
    if (v.file !== `${v.id}.json` || !v.id.startsWith(`${v.family}/`)) fail(`${v.id}: id, family and file disagree`);
    if (!manifest.families.includes(v.family)) fail(`${v.id}: family '${v.family}' is not registered`);
    if (!KINDS.has(v.kind)) fail(`${v.id}: unknown kind '${v.kind}'`);
    if (!files.has(v.file)) {
      fail(`${v.id}: no file ${v.file}`);
      continue;
    }
    if (sha256Hex(files.get(v.file)) !== v.sha256) fail(`${v.id}: the recorded sha256 is not the file's`);
    if ((v.kind === "hash" || v.kind === "accept") && !/^sha256:[0-9a-f]{64}$/.test(v.digest ?? "")) fail(`${v.id}: no well-formed digest`);
    if (v.kind === "accept" && typeof v.canonical !== "string") fail(`${v.id}: an accept vector records its canonical document`);
    if (v.kind === "reject" && (!CLASSES.has(v.reject) || !["schema", "rule"].includes(v.detect)))
      fail(`${v.id}: a reject vector names a registered class and a detection`);
    if (typeof v.description !== "string" || v.description.length === 0) fail(`${v.id}: no description`);
  }
  for (const file of files.keys()) if (!enumerated.has(file)) fail(`${file}: on disk and in no manifest entry (an orphan nobody runs)`);
  for (const family of manifest.families)
    if (!manifest.vectors.some((v) => v.family === family)) fail(`family '${family}' carries no vector`);

  // 2–4. structure, rules, rejection
  const audit = [];
  auditKeywords(rootSchema, "", audit);
  audit.forEach(fail);

  for (const v of manifest.vectors) {
    if (!files.has(v.file)) continue;
    const text = files.get(v.file).toString("utf8");
    documents += 1;
    let doc;
    let parseError = null;
    try {
      doc = parseStrict(text);
    } catch (error) {
      parseError = error.message;
    }

    if (v.kind === "reject") {
      const schemaBad = parseError ? [] : validate(doc, rootSchema);
      const ruleBad = parseError ? [parseError] : ruleViolations(doc, false);
      const caught = v.detect === "schema" ? schemaBad.length > 0 : ruleBad.length > 0;
      if (!caught) fail(`${v.id}: a reject vector its detection ('${v.detect}') does not refuse`);
      continue;
    }
    if (parseError) {
      fail(`${v.id}: ${parseError}`);
      continue;
    }
    for (const b of validate(doc, rootSchema)) fail(`${v.id}: schema ${b}`);
    for (const b of ruleViolations(doc, v.kind !== "accept")) fail(`${v.id}: rule ${b}`);
    if (v.kind === "accept") {
      const c = parseStrict(v.canonical);
      for (const b of validate(c, rootSchema)) fail(`${v.id} (canonical): schema ${b}`);
      for (const b of ruleViolations(c, true)) fail(`${v.id} (canonical): rule ${b}`);
    }
  }
  return { failures, documents };
}

function filesOnDisk() {
  const out = new Map();
  for (const family of readdirSync(here)) {
    const dir = join(here, family);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) out.set(relative(here, join(dir, f)).replaceAll("\\", "/"), readFileSync(join(dir, f)));
  }
  return out;
}

const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const files = filesOnDisk();

if (selfTest) {
  let red = 0;
  const expectRed = (what, m, f) => {
    if (check(m, f).failures.length === 0) {
      console.error(`FAIL self-test: ${what} did not go red`);
      red += 1;
    } else console.log(`ok   self-test: ${what} goes red`);
  };
  const withFile = (file, text) => new Map([...files, [file, Buffer.from(text, "utf8")]]);
  const reindexed = (id, text) => ({
    ...manifest,
    vectors: manifest.vectors.map((v) => (v.id === id ? { ...v, sha256: sha256Hex(Buffer.from(text, "utf8")) } : v)),
  });
  const hashVector = manifest.vectors.find((v) => v.kind === "hash");
  const rejectVector = manifest.vectors.find((v) => v.kind === "reject" && v.detect === "schema");

  expectRed("a stale sha256", { ...manifest, vectors: manifest.vectors.map((v) => (v.id === hashVector.id ? { ...v, sha256: "0".repeat(64) } : v)) }, files);
  expectRed("an orphan file", manifest, withFile("step/orphan.json", "[]"));
  const unknownStep = '[{"$type":"explode"}]';
  expectRed("a document the schema refuses", reindexed(hashVector.id, unknownStep), withFile(hashVector.file, unknownStep));
  const inadmissible =
    '[{"$type":"fit","control":{"maxIter":25,"tol":1E-08},"family":"binomial","groupBy":[],"intercept":true,"link":"identity","output":"coefficients","predictors":[],"response":"y"}]';
  expectRed("an inadmissible family and link", reindexed(hashVector.id, inadmissible), withFile(hashVector.file, inadmissible));
  const badDate = '[{"$type":"filter","pred":{"$type":"lit","cell":{"$type":"Date","value":"2026-02-30"}}}]';
  expectRed("a day the calendar does not have", reindexed(hashVector.id, badDate), withFile(hashVector.file, badDate));
  const readable = '[{"$type":"distinct"}]';
  expectRed("a reject vector that is readable", reindexed(rejectVector.id, readable), withFile(rejectVector.file, readable));
  expectRed("a reject class nobody registered", { ...manifest, vectors: manifest.vectors.map((v) => (v.id === rejectVector.id ? { ...v, reject: "made-up" } : v)) }, files);
  expectRed("a repeated member", reindexed(hashVector.id, '[{"$type":"distinct","$type":"distinct"}]'), withFile(hashVector.file, '[{"$type":"distinct","$type":"distinct"}]'));

  if (red > 0) process.exit(1);
  console.log("validate.mjs self-test: every check goes red");
} else {
  const { failures, documents } = check(manifest, files);
  for (const f of failures) console.error(`FAIL ${f}`);
  if (documents !== manifest.vectors.length) {
    console.error(`FAIL checked ${documents} documents, the manifest enumerates ${manifest.vectors.length}`);
    process.exit(1);
  }
  if (failures.length > 0) process.exit(1);
  console.log(`validate.mjs: ${documents} vectors indexed, structured, ruled and rejected as declared`);
}
