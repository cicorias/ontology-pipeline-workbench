// SPARQL (Oxigraph, compiled to WebAssembly) and SHACL (rdf-validate-shacl) over the project's triples.

import initOxigraph, { Store } from 'oxigraph/web.js'
import { Store as N3Store } from 'n3'
import SHACLValidator from 'rdf-validate-shacl'
import { toNTriples } from './rdf.js'

let ready = null
export const oxigraphReady = () => (ready ||= initOxigraph())

export async function sparql(quads, query) {
  await oxigraphReady()
  const store = new Store()
  store.load(toNTriples(quads), { format: 'application/n-triples' })
  const res = store.query(query)
  if (typeof res === 'boolean') return { kind: 'ask', value: res }
  if (typeof res === 'string') return { kind: 'text', value: res }
  if (!Array.isArray(res)) return { kind: 'text', value: String(res) }
  if (res.length && !(res[0] instanceof Map)) return { kind: 'graph', quads: res }
  const vars = projection(query) || [...new Set(res.flatMap((m) => [...m.keys()]))]
  return { kind: 'select', vars, rows: res.map((m) => Object.fromEntries([...m.entries()].map(([k, v]) => [k, v]))) }
}

// the SELECT clause's own order, so columns read the way the query was written
function projection(q) {
  const m = q.replace(/#[^\n]*/g, '').match(/SELECT\s+(?:DISTINCT\s+|REDUCED\s+)?([\s\S]*?)\s*(?:WHERE|FROM|\{)/i)
  if (!m || /^\*/.test(m[1].trim())) return null
  const vars = []
  for (const x of m[1].matchAll(/\(\s*[\s\S]*?\s+AS\s+\?(\w+)\s*\)|\?(\w+)/gi)) vars.push(x[1] || x[2])
  return vars.length ? vars : null
}

export async function validateShacl(shapeQuads, dataQuads) {
  // the validator's own RDF/JS environment is browser-safe; it takes the shapes as quads and the data as a dataset
  const report = await new SHACLValidator(shapeQuads).validate(new N3Store(dataQuads))
  return {
    conforms: report.conforms,
    results: report.results.map((r) => ({
      focus: r.focusNode?.value,
      path: r.path?.value,
      shape: r.sourceShape?.value,
      component: r.sourceConstraintComponent?.value?.replace(/^.*#/, ''),
      message: r.message.map((m) => m.value).join(' '),
      value: r.value?.value,
    })),
  }
}
