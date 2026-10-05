// A small forward-chaining reasoner: the RDFS rules that matter for a test ABox, plus the thin OWL frame
// (inverseOf, TransitiveProperty, FunctionalProperty, disjointWith). Returns what it inferred and what is inconsistent.

import { DataFactory } from 'n3'
import { NS, RDF_TYPE, STANDARDS } from './vocab.js'

const { namedNode, quad } = DataFactory
const SUBCLASS = NS.rdfs + 'subClassOf', SUBPROP = NS.rdfs + 'subPropertyOf'
const DOMAIN = NS.rdfs + 'domain', RANGE = NS.rdfs + 'range'

// what the reused standards say about themselves (foaf:Person is a foaf:Agent), so typing carries through
export function backgroundQuads() {
  const out = []
  for (const std of Object.values(STANDARDS)) {
    for (const [local, sup] of Object.entries(std.classes)) {
      if (!sup) continue
      const [v, l] = sup.split(':')
      out.push(quad(namedNode(std.ns + local), namedNode(SUBCLASS), namedNode(STANDARDS[v].ns + l)))
    }
  }
  return out
}

const LITERAL_OK = {
  integer: /^[+-]?\d+$/, decimal: /^[+-]?\d+(\.\d+)?$/, boolean: /^(true|false|0|1)$/,
  date: /^\d{4}-\d{2}-\d{2}$/, dateTime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/,
  gYear: /^\d{4}$/, anyURI: /^\S+:\S+$/,
}

export function reason(quads, opts = {}) {
  const key = (t) => t.termType + '|' + t.value + '|' + (t.language || '') + '|' + (t.datatype ? t.datatype.value : '')
  const all = new Map()
  const bySP = new Map()   // predicate -> array of quads
  const inferred = []
  const put = (q, rule) => {
    const k = key(q.subject) + ' ' + q.predicate.value + ' ' + key(q.object)
    if (all.has(k)) return false
    all.set(k, q)
    if (!bySP.has(q.predicate.value)) bySP.set(q.predicate.value, [])
    bySP.get(q.predicate.value).push(q)
    if (rule) inferred.push({ quad: q, rule })
    return true
  }
  for (const q of [...quads, ...backgroundQuads()]) put(q, null)
  const P = (p) => bySP.get(p) || []
  const N = namedNode

  const transitive = new Set(P(RDF_TYPE).filter((q) => q.object.value === NS.owl + 'TransitiveProperty').map((q) => q.subject.value))
  const functional = new Set(P(RDF_TYPE).filter((q) => q.object.value === NS.owl + 'FunctionalProperty').map((q) => q.subject.value))
  const inverse = []
  for (const q of P(NS.owl + 'inverseOf')) { inverse.push([q.subject.value, q.object.value]); inverse.push([q.object.value, q.subject.value]) }

  let changed = true, rounds = 0
  while (changed && rounds++ < 40) {
    changed = false
    // rdfs11 / rdfs5: subClassOf and subPropertyOf are transitive
    for (const rel of [SUBCLASS, SUBPROP]) {
      for (const a of [...P(rel)]) for (const b of [...P(rel)]) {
        if (a.object.value === b.subject.value && a.subject.value !== b.object.value)
          changed = put(quad(a.subject, N(rel), b.object), rel === SUBCLASS ? 'rdfs11' : 'rdfs5') || changed
      }
    }
    // rdfs7: a p b, p ⊑ q → a q b
    for (const sp of [...P(SUBPROP)]) for (const t of [...P(sp.subject.value)])
      changed = put(quad(t.subject, N(sp.object.value), t.object), `rdfs7 (${short(sp.subject.value)} ⊑ ${short(sp.object.value)})`) || changed
    // inverseOf
    for (const [p, q] of inverse) for (const t of [...P(p)]) if (t.object.termType !== 'Literal')
      changed = put(quad(t.object, N(q), t.subject), `owl:inverseOf (${short(p)})`) || changed
    // TransitiveProperty
    for (const p of transitive) for (const a of [...P(p)]) for (const b of [...P(p)])
      if (a.object.value === b.subject.value && a.subject.value !== b.object.value)
        changed = put(quad(a.subject, N(p), b.object), `owl:TransitiveProperty (${short(p)})`) || changed
    // rdfs2 / rdfs3: domain and range type their subjects and objects
    for (const d of [...P(DOMAIN)]) for (const t of [...P(d.subject.value)])
      if (t.subject.termType === 'NamedNode') changed = put(quad(t.subject, N(RDF_TYPE), d.object), `rdfs2 (domain of ${short(d.subject.value)})`) || changed
    for (const r of [...P(RANGE)]) {
      const c = r.object.value
      if (c.startsWith(NS.xsd) || c === NS.rdfs + 'Literal' || c === NS.rdfs + 'Resource') continue
      for (const t of [...P(r.subject.value)]) if (t.object.termType === 'NamedNode')
        changed = put(quad(t.object, N(RDF_TYPE), N(c)), `rdfs3 (range of ${short(r.subject.value)})`) || changed
    }
    // rdfs9: a type C, C ⊑ D → a type D
    for (const t of [...P(RDF_TYPE)]) for (const sc of P(SUBCLASS)) if (sc.subject.value === t.object.value)
      changed = put(quad(t.subject, N(RDF_TYPE), sc.object), `rdfs9 (${short(t.object.value)} ⊑ ${short(sc.object.value)})`) || changed
  }

  const problems = []
  const label = opts.label || ((v) => v)
  // disjointWith: one individual in two disjoint classes
  const typesOf = new Map()
  for (const t of P(RDF_TYPE)) { if (!typesOf.has(t.subject.value)) typesOf.set(t.subject.value, new Set()); typesOf.get(t.subject.value).add(t.object.value) }
  for (const d of P(NS.owl + 'disjointWith')) for (const [s, ts] of typesOf)
    if (ts.has(d.subject.value) && ts.has(d.object.value) && d.subject.value < d.object.value)
      problems.push({ sev: 'error', box: 'ABox', msg: `${label(s)} is both a ${label(d.subject.value)} and a ${label(d.object.value)}, which are disjoint.`, where: s })
  // FunctionalProperty: more than one distinct value
  for (const p of functional) {
    const vals = new Map()
    for (const t of P(p)) { if (!vals.has(t.subject.value)) vals.set(t.subject.value, new Set()); vals.get(t.subject.value).add(key(t.object)) }
    for (const [s, v] of vals) if (v.size > 1) problems.push({ sev: 'error', box: 'ABox', msg: `${label(p)} is functional but ${label(s)} has ${v.size} values.`, where: s })
  }
  // literal values must fit the declared datatype range; object properties must not carry literals
  for (const r of P(RANGE)) {
    const c = r.object.value
    for (const t of P(r.subject.value)) {
      if (c.startsWith(NS.xsd)) {
        const dt = c.slice(NS.xsd.length)
        if (t.object.termType !== 'Literal') problems.push({ sev: 'error', box: 'ABox', msg: `${label(r.subject.value)} expects an xsd:${dt} literal but ${label(t.subject.value)} points at ${label(t.object.value)}.`, where: t.subject.value })
        else if (LITERAL_OK[dt] && !LITERAL_OK[dt].test(t.object.value)) problems.push({ sev: 'error', box: 'ABox', msg: `"${t.object.value}" is not a valid xsd:${dt} (${label(r.subject.value)} on ${label(t.subject.value)}).`, where: t.subject.value })
      } else if (c !== NS.rdfs + 'Literal' && t.object.termType === 'Literal') {
        problems.push({ sev: 'error', box: 'ABox', msg: `${label(r.subject.value)} expects a ${label(c)} but ${label(t.subject.value)} has the literal "${t.object.value}".`, where: t.subject.value })
      }
    }
  }
  return { inferred, problems, closure: [...all.values()] }
}

function short(iri) {
  return iri.replace(/^.*[#/]/, '')
}
