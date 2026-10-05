// Runs the built-in example through every engine outside the browser: RDF, reasoning, SHACL, and every competency query.
import ox from 'oxigraph'
import { researchExample } from '../src/example.js'
import { buildQuads, shapeQuads, toTurtle, toNTriples, toJsonLd } from '../src/rdf.js'
import { reason } from '../src/reason.js'
import { validateShacl } from '../src/engine.js'

const st = researchExample()
let failed = 0
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++ }

const all = buildQuads(st, 'all')
for (const l of ['cbox', 'tbox', 'abox']) check(buildQuads(st, l).length > 0, `${l} layer has ${buildQuads(st, l).length} triples`)
const ttl = toTurtle(st, all)
check(ttl.includes('@prefix rkg:') && ttl.includes('skos:Concept'), `Turtle serializes (${ttl.length} chars)`)
JSON.parse(toJsonLd(st, all)); check(true, 'JSON-LD parses')

const r = reason(all)
check(r.problems.length === 0, `reasoner finds no inconsistency (${r.problems.map((p) => p.msg).join('; ')})`)
const has = (s, p, o) => r.closure.some((q) => q.subject.value.endsWith(s) && q.predicate.value.endsWith(p) && q.object.value.endsWith(o))
check(has('method-local-global', 'extendsMethod', 'method-dense'), 'transitive closure: local-global extends dense')
check(has('researcher-tan', 'authorOf', 'paper-local-global'), 'inverse: Tan authorOf paper')
check(has('researcher-tan', 'type', 'foaf/0.1/Agent'), 'subclass chain: researcher is a foaf:Agent')
check(has('paper-local-global', 'wasAttributedTo', 'researcher-tan'), 'subPropertyOf: authoredBy implies prov:wasAttributedTo')

const rep = await validateShacl(shapeQuads(st), r.closure)
check(rep.conforms, `SHACL conforms (${rep.results.map((x) => x.focus + ' ' + x.message).join('; ')})`)

const store = new ox.Store()
store.load(toNTriples(r.closure), { format: 'application/n-triples' })
for (const q of st.onto.cqs) {
  const rows = store.query(q.sparql)
  check(rows.length > 0, `${q.id} returns ${rows.length} row(s): ${q.text}`)
}

// a broken copy must be caught: second paper type, a literal where a lab belongs, and a dataset typed as a paper
const bad = researchExample()
bad.onto.individuals['paper-local-global'].vals.push({ p: 'dct:type', k: 'concept', v: 'Survey' })
bad.onto.individuals['researcher-tan'].vals.push({ p: 'affiliatedWith', k: 'lit', v: 'Harbor' })
bad.onto.individuals['dataset-lectures'].types.push('Paper')
const rb = reason(buildQuads(bad, 'all'))
check(rb.problems.some((p) => /disjoint/.test(p.msg)), 'catches disjoint Paper/Dataset')
check(rb.problems.some((p) => /literal/.test(p.msg)), 'catches a literal on an object property')
const repBad = await validateShacl(shapeQuads(bad), rb.closure)
check(!repBad.conforms && repBad.results.some((x) => /paper type/.test(x.message)), 'SHACL catches two paper types')

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
