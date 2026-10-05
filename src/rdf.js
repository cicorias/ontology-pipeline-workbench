// Turns a project into RDF quads (CBox, TBox, ABox) and serializes them.

import { DataFactory, Writer } from 'n3'
import { NS, RDF_TYPE, STANDARDS, DC_ELEMENTS, dcKind } from './vocab.js'

const { namedNode, literal, quad, blankNode } = DataFactory

export const fallbackBase = { concept: 'urn:concept:', schema: 'urn:schema:', data: 'urn:data:' }

export function bases(st) {
  const b = st.onto.base
  return { concept: b.concept || fallbackBase.concept, schema: b.schema || fallbackBase.schema, data: b.data || fallbackBase.data }
}

export function prefixes(st) {
  const p = { rdf: NS.rdf, rdfs: NS.rdfs, owl: NS.owl, xsd: NS.xsd, skos: NS.skos, dct: NS.dct, sh: NS.sh }
  for (const v of st.onto.reuse) if (STANDARDS[v]) p[v] = STANDARDS[v].ns
  const b = bases(st), pre = st.onto.prefix
  if (pre.concept) p[pre.concept] = b.concept
  if (pre.schema) p[pre.schema] = b.schema
  if (pre.data) p[pre.data] = b.data
  return p
}

// a reference is an absolute IRI, a CURIE with a known prefix, or a local name in the given home namespace
export function expand(st, ref, home = 'schema') {
  if (!ref) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref) || ref.startsWith('urn:')) return ref
  const i = ref.indexOf(':')
  if (i > 0) {
    const pre = ref.slice(0, i), all = { ...prefixes(st), ...Object.fromEntries(Object.entries(STANDARDS).map(([k, v]) => [k, v.ns])) }
    if (all[pre]) return all[pre] + ref.slice(i + 1)
  }
  return bases(st)[home] + ref
}

export function compact(st, iri) {
  let best = null
  for (const [p, ns] of Object.entries(prefixes(st))) {
    if (iri.startsWith(ns) && iri.length > ns.length && (!best || ns.length > best[1].length)) best = [p, ns]
  }
  return best ? best[0] + ':' + iri.slice(best[1].length) : iri
}

export const ontologyIri = (st) => bases(st).schema.replace(/[#/]$/, '')

// Everything the studio knows about a property reference: own property, Dublin Core element, or a reused standard property.
export function propInfo(st, ref) {
  if (!ref) return null
  if (ref.startsWith('dct:')) {
    const name = ref.slice(4), el = st.profile.elements[name]
    const kind = dcKind(name)
    const range = el && el.encoding === 'vocab' || kind === 'concept' ? 'skos:Concept'
      : kind === 'date' || (el && el.encoding === 'iso8601') ? 'xsd:date'
      : kind === 'iri' || (el && el.encoding === 'iri') ? 'iri' : 'xsd:string'
    return { ref, iri: NS.dct + name, label: (DC_ELEMENTS.find((e) => e[0] === name) || [name, name])[1], domain: '', range, functional: el?.max === '1', source: 'profile', schemes: el?.schemes || [] }
  }
  const i = ref.indexOf(':')
  if (i > 0) {
    const v = ref.slice(0, i), local = ref.slice(i + 1), std = STANDARDS[v]
    if (std && std.props[local]) {
      const [domain, range] = std.props[local]
      return { ref, iri: std.ns + local, label: local, domain, range, functional: false, source: v }
    }
    return { ref, iri: expand(st, ref), label: local, domain: '', range: '', functional: false, source: 'unknown' }
  }
  const d = st.onto.props[ref]
  if (!d) return null
  return { ref, iri: bases(st).schema + ref, label: d.label || ref, domain: d.domain, range: d.range, functional: !!d.functional, source: 'own' }
}

// the kind of value a range takes: an individual, a concept, an IRI, or a literal of a datatype
export function rangeKind(range) {
  if (!range) return 'lit'
  if (range === 'skos:Concept') return 'concept'
  if (range === 'iri') return 'iri'
  if (range.startsWith('xsd:') || range === 'rdfs:Literal') return 'lit'
  return 'ind'
}

export function propKind(st, d) {
  const k = rangeKind(d.range)
  return d.range ? (k === 'lit' ? 'DatatypeProperty' : 'ObjectProperty') : ''
}

export function termsInScheme(st, sid) {
  return Object.keys(st.vocab.terms).filter((k) => st.vocab.terms[k].scheme === sid)
}

export function placedTerms(st) {
  return Object.keys(st.vocab.terms).filter((k) => st.schemes[st.vocab.terms[k].scheme])
}

export function buildQuads(st, layer = 'all') {
  const out = []
  const B = bases(st)
  const lang = 'en'
  const N = (v) => namedNode(v)
  const L = (v, dt) => (dt ? literal(String(v), N(dt)) : literal(String(v), lang))
  const add = (s, p, o) => out.push(quad(typeof s === 'string' ? N(s) : s, N(p), o))
  const want = (l) => layer === 'all' || layer === l
  const ont = ontologyIri(st)
  const O = st.onto

  if (want('cbox')) {
    // the ontology record: its governance lives with the vocabulary
    if (O.title) {
      add(ont, RDF_TYPE, N(NS.owl + 'Ontology'))
      add(ont, NS.dct + 'title', L(O.title))
      if (O.description) add(ont, NS.dct + 'description', L(O.description))
      if (O.creator) add(ont, NS.dct + 'creator', literal(O.creator))
      if (O.license) add(ont, NS.dct + 'license', /^https?:/.test(O.license) ? N(O.license) : literal(O.license))
      if (O.version) add(ont, NS.owl + 'versionInfo', literal(O.version))
      add(ont, NS.owl + 'imports', N('http://www.w3.org/2004/02/skos/core'))
      for (const v of O.reuse) if (STANDARDS[v]?.imports) add(ont, NS.owl + 'imports', N(STANDARDS[v].imports))
    }
    for (const [sid, sc] of Object.entries(st.schemes)) {
      const s = B.concept + sid
      add(s, RDF_TYPE, N(NS.skos + 'ConceptScheme'))
      add(s, NS.skos + 'prefLabel', L(sc.title || sid))
      if (sc.description) add(s, NS.skos + 'definition', L(sc.description))
    }
    for (const [cid, t] of Object.entries(st.vocab.terms)) {
      if (!st.schemes[t.scheme]) continue
      const c = B.concept + cid
      add(c, RDF_TYPE, N(NS.skos + 'Concept'))
      add(c, NS.skos + 'inScheme', N(B.concept + t.scheme))
      add(c, NS.skos + 'prefLabel', L(t.label || cid))
      t.alt.filter(Boolean).forEach((a) => add(c, NS.skos + 'altLabel', L(a)))
      t.hidden.filter(Boolean).forEach((a) => add(c, NS.skos + 'hiddenLabel', L(a)))
      if (t.definition) add(c, NS.skos + 'definition', L(t.definition))
      if (t.scopeNote) add(c, NS.skos + 'scopeNote', L(t.scopeNote))
      if (t.example) add(c, NS.skos + 'example', L(t.example))
      if (t.notation) add(c, NS.skos + 'notation', literal(t.notation))
      if (t.source) add(c, NS.dct + 'source', literal(t.source))
      if (t.status === 'deprecated') {
        add(c, NS.owl + 'deprecated', literal('true', N(NS.xsd + 'boolean')))
        if (t.replacedBy && st.vocab.terms[t.replacedBy]) add(c, NS.dct + 'isReplacedBy', N(B.concept + t.replacedBy))
      }
      const parent = t.broader && st.vocab.terms[t.broader]
      if (parent && st.schemes[parent.scheme]) {
        add(c, NS.skos + 'broader', N(B.concept + t.broader))
        add(B.concept + t.broader, NS.skos + 'narrower', N(c))
      } else {
        add(c, NS.skos + 'topConceptOf', N(B.concept + t.scheme))
        add(B.concept + t.scheme, NS.skos + 'hasTopConcept', N(c))
      }
      t.related.filter((r) => st.vocab.terms[r]?.scheme).forEach((r) => add(c, NS.skos + 'related', N(B.concept + r)))
      t.matches.filter((m) => m.uri).forEach((m) => add(c, NS.skos + m.rel, N(m.uri)))
    }
    for (const [id, col] of Object.entries(st.collections)) {
      const c = B.concept + 'collection-' + id
      add(c, RDF_TYPE, N(NS.skos + (col.ordered ? 'OrderedCollection' : 'Collection')))
      add(c, NS.skos + 'prefLabel', L(col.label))
      const members = col.members.filter((m) => st.vocab.terms[m]?.scheme)
      if (col.ordered) {
        let head = members.length ? blankNode() : N(NS.rdf + 'nil')
        add(c, NS.skos + 'memberList', head)
        members.forEach((m, i) => {
          add(head, NS.rdf + 'first', N(B.concept + m))
          const next = i < members.length - 1 ? blankNode() : N(NS.rdf + 'nil')
          add(head, NS.rdf + 'rest', next)
          head = next
        })
      } else members.forEach((m) => add(c, NS.skos + 'member', N(B.concept + m)))
    }
  }

  if (want('tbox')) {
    for (const [k, d] of Object.entries(O.classes)) {
      const s = B.schema + k
      add(s, RDF_TYPE, N(NS.owl + 'Class'))
      if (d.label) add(s, NS.rdfs + 'label', L(d.label))
      if (d.comment) add(s, NS.rdfs + 'comment', L(d.comment))
      d.sub.forEach((x) => add(s, NS.rdfs + 'subClassOf', N(expand(st, x))))
      d.disjoint.forEach((x) => add(s, NS.owl + 'disjointWith', N(expand(st, x))))
      if (d.fromConcept && st.vocab.terms[d.fromConcept]) add(s, NS.skos + 'exactMatch', N(B.concept + d.fromConcept))
      add(s, NS.rdfs + 'isDefinedBy', N(ont))
    }
    for (const [k, d] of Object.entries(O.props)) {
      const s = B.schema + k
      const kind = propKind(st, d)
      add(s, RDF_TYPE, N(kind ? NS.owl + kind : NS.rdf + 'Property'))
      if (d.functional) add(s, RDF_TYPE, N(NS.owl + 'FunctionalProperty'))
      if (d.transitive && kind === 'ObjectProperty') add(s, RDF_TYPE, N(NS.owl + 'TransitiveProperty'))
      if (d.label) add(s, NS.rdfs + 'label', L(d.label))
      if (d.comment) add(s, NS.rdfs + 'comment', L(d.comment))
      if (d.domain) add(s, NS.rdfs + 'domain', N(expand(st, d.domain)))
      if (d.range) add(s, NS.rdfs + 'range', N(d.range === 'iri' ? NS.rdfs + 'Resource' : expand(st, d.range)))
      if (d.inverse && O.props[d.inverse]) add(s, NS.owl + 'inverseOf', N(B.schema + d.inverse))
      if (d.sub) add(s, NS.rdfs + 'subPropertyOf', N(propInfo(st, d.sub)?.iri || expand(st, d.sub)))
      add(s, NS.rdfs + 'isDefinedBy', N(ont))
    }
    out.push(...shapeQuads(st))
  }

  if (want('abox')) {
    for (const [k, d] of Object.entries(O.individuals)) {
      const s = B.data + k
      d.types.filter(Boolean).forEach((t) => add(s, RDF_TYPE, N(expand(st, t))))
      if (d.label) add(s, NS.rdfs + 'label', L(d.label))
      if (d.comment) add(s, NS.rdfs + 'comment', L(d.comment))
      for (const v of d.vals) {
        const info = propInfo(st, v.p)
        if (!info || v.v === '' || v.v == null) continue
        const range = info.range || ''
        if (v.k === 'ind') add(s, info.iri, N(B.data + v.v))
        else if (v.k === 'concept') add(s, info.iri, N(B.concept + v.v))
        else if (v.k === 'iri') add(s, info.iri, N(v.v))
        else if (range.startsWith('xsd:') && range !== 'xsd:string') add(s, info.iri, literal(String(v.v), N(NS.xsd + range.slice(4))))
        else add(s, info.iri, literal(String(v.v)))
      }
    }
  }
  return out
}

// SHACL: one node shape per entry, with a single property constraint on a path of one or two steps
export function shapeQuads(st) {
  const out = []
  const B = bases(st)
  const N = (v) => namedNode(v)
  const add = (s, p, o) => out.push(quad(s, N(p), o))
  for (const [id, sh] of Object.entries(st.onto.shapes)) {
    const s = N(B.schema + id)
    add(s, RDF_TYPE, N(NS.sh + 'NodeShape'))
    if (sh.target) add(s, NS.sh + 'targetClass', N(expand(st, sh.target)))
    const steps = sh.path.filter(Boolean).map((p) => N(propInfo(st, p)?.iri || expand(st, p)))
    if (!steps.length) continue
    const ps = blankNode()
    add(s, NS.sh + 'property', ps)
    if (steps.length === 1) add(ps, NS.sh + 'path', steps[0])
    else {
      let head = blankNode()
      add(ps, NS.sh + 'path', head)
      steps.forEach((st2, i) => {
        add(head, NS.rdf + 'first', st2)
        const next = i < steps.length - 1 ? blankNode() : N(NS.rdf + 'nil')
        add(head, NS.rdf + 'rest', next)
        head = next
      })
    }
    const int = (v) => literal(String(v), N(NS.xsd + 'integer'))
    if (sh.min !== '' && sh.min != null) add(ps, NS.sh + 'minCount', int(sh.min))
    if (sh.max !== '' && sh.max != null) add(ps, NS.sh + 'maxCount', int(sh.max))
    if (sh.cls) add(ps, NS.sh + 'class', N(expand(st, sh.cls)))
    if (sh.datatype) add(ps, NS.sh + 'datatype', N(expand(st, sh.datatype)))
    if (sh.hasValue) add(ps, NS.sh + 'hasValue', /^(true|false)$/.test(sh.hasValue) ? literal(sh.hasValue, N(NS.xsd + 'boolean')) : literal(sh.hasValue))
    if (sh.message) add(ps, NS.sh + 'message', literal(sh.message, 'en'))
  }
  return out
}

export function toTurtle(st, quads) {
  let result = ''
  const used = {}
  const all = prefixes(st)
  const ser = new Writer({ prefixes: all })
  ser.addQuads(quads)
  ser.end((err, text) => { if (err) throw err; result = text })
  // drop prefix declarations nothing uses, so a layer's Turtle stays short
  const body = result.replace(/^@prefix [^\n]*\n/gm, '')
  for (const p of Object.keys(all)) if (new RegExp(`(^|[\\s(\\[,;^])${p}:`, 'm').test(body)) used[p] = all[p]
  return Object.entries(used).map(([p, ns]) => `@prefix ${p}: <${ns}> .`).join('\n') + '\n\n' + body.trim() + '\n'
}

export function toNTriples(quads) {
  return new Writer({ format: 'N-Triples' }).quadsToString(quads)
}

export function toJsonLd(st, quads) {
  const nodes = new Map()
  const id = (t) => (t.termType === 'BlankNode' ? '_:' + t.value : t.value)
  for (const q of quads) {
    const s = id(q.subject)
    if (!nodes.has(s)) nodes.set(s, { '@id': s })
    const n = nodes.get(s)
    if (q.predicate.value === RDF_TYPE) { (n['@type'] ||= []).push(q.object.value); continue }
    const o = q.object.termType === 'Literal'
      ? (q.object.language ? { '@value': q.object.value, '@language': q.object.language }
        : q.object.datatype.value === NS.xsd + 'string' ? q.object.value : { '@value': q.object.value, '@type': q.object.datatype.value })
      : { '@id': id(q.object) }
    ;(n[q.predicate.value] ||= []).push(o)
  }
  return JSON.stringify({ '@context': prefixes(st), '@graph': [...nodes.values()] }, null, 2)
}
