// Force-directed drawing of the project's triples with d3.

import * as d3 from 'd3'
import { NS, RDF_TYPE } from './vocab.js'

const HIERARCHY = new Set([NS.rdfs + 'subClassOf', NS.skos + 'broader', RDF_TYPE])
const QUIET = new Set([NS.skos + 'inScheme', NS.rdfs + 'isDefinedBy', NS.skos + 'member'])
const SKIP = new Set([NS.skos + 'narrower', NS.skos + 'hasTopConcept', NS.skos + 'topConceptOf', NS.rdf + 'first', NS.rdf + 'rest', NS.skos + 'memberList', NS.owl + 'imports'])
const COLORS = { Scheme: '#26364d', Concept: '#4f7cc0', Collection: '#39876b', Ontology: '#555', Class: '#7a4a8c', Property: '#b8860b', Individual: '#c4682f', External: '#8a929c' }

let sim = null

// the page re-renders on every change; a simulation for an SVG no longer on screen must not keep running
export function stopGraph() { if (sim) { sim.stop(); sim = null } }

export function drawGraph(svgEl, infoEl, quads, opts) {
  const { bases, compact, layers, focus, edgeLabels } = opts
  const layerOf = (iri) => iri.startsWith(bases.data) ? 'abox' : iri.startsWith(bases.concept) ? 'cbox' : iri.startsWith(bases.schema) || iri === bases.schema.replace(/[#/]$/, '') ? 'tbox' : 'ext'
  const types = {}, labels = {}
  for (const q of quads) {
    if (q.predicate.value === RDF_TYPE) (types[q.subject.value] ||= []).push(q.object.value)
    if ([NS.skos + 'prefLabel', NS.rdfs + 'label', NS.dct + 'title'].includes(q.predicate.value) && q.object.termType === 'Literal' && !labels[q.subject.value]) labels[q.subject.value] = q.object.value
  }
  const kindOf = (iri) => {
    const t = types[iri] || []
    if (t.includes(NS.skos + 'ConceptScheme')) return 'Scheme'
    if (t.includes(NS.skos + 'Concept')) return 'Concept'
    if (t.some((x) => x.startsWith(NS.skos) && x.endsWith('Collection'))) return 'Collection'
    if (t.includes(NS.owl + 'Ontology')) return 'Ontology'
    if (t.includes(NS.owl + 'Class')) return 'Class'
    if (t.some((x) => /Property$/.test(x))) return 'Property'
    if (layerOf(iri) === 'abox') return 'Individual'
    return 'External'
  }
  const visible = (iri) => {
    if ((types[iri] || []).includes(NS.sh + 'NodeShape')) return false
    const l = layerOf(iri)
    return l === 'ext' || layers[l]
  }
  const vocabType = (o) => [NS.owl, NS.rdfs, NS.rdf, NS.skos, NS.sh].some((ns) => o.startsWith(ns))

  // a query result: its things plus whatever connects two of them
  let keep = null
  if (focus && focus.size) {
    keep = new Set(focus)
    const neighbours = new Map()
    for (const q of quads) {
      if (q.object.termType !== 'NamedNode' || SKIP.has(q.predicate.value)) continue
      const a = q.subject.value, b = q.object.value
      if (focus.has(a) && !focus.has(b)) neighbours.set(b, (neighbours.get(b) || 0) + 1)
      if (focus.has(b) && !focus.has(a)) neighbours.set(a, (neighbours.get(a) || 0) + 1)
    }
    for (const [n, c] of neighbours) if (c >= 2 || focus.size <= 2) keep.add(n)
  }
  const ids = new Set(), edges = []
  for (const q of quads) {
    if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode' || SKIP.has(q.predicate.value)) continue
    if (q.predicate.value.startsWith(NS.sh)) continue
    if (q.predicate.value === RDF_TYPE && vocabType(q.object.value)) continue
    const s = q.subject.value, o = q.object.value
    if (!visible(s) || !visible(o)) continue
    if (keep && !(keep.has(s) && keep.has(o))) continue
    ids.add(s); ids.add(o)
    edges.push({ source: s, target: o, p: q.predicate.value })
  }
  for (const s of Object.keys(types)) if (visible(s) && layerOf(s) !== 'ext' && (!keep || keep.has(s)) && !s.startsWith('_:') && !(types[s] || []).includes(NS.sh + 'NodeShape')) ids.add(s)
  const nodes = [...ids].map((id) => ({ id, kind: kindOf(id), label: labels[id] || compact(id), faded: keep && focus && !focus.has(id) }))

  const W = svgEl.clientWidth || 900, H = svgEl.clientHeight || 600
  const svg = d3.select(svgEl)
  svg.selectAll('*').remove()
  infoEl.style.display = 'none'
  if (!nodes.length) {
    svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle').text('Nothing to draw with these layers.')
    return { nodes: 0, edges: 0 }
  }
  svg.append('defs').append('marker').attr('id', 'arrow').attr('viewBox', '0 -4 8 8').attr('refX', 15).attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', '#7a8696')
  const g = svg.append('g')
  const zoom = d3.zoom().scaleExtent([0.15, 4]).on('zoom', (e) => g.attr('transform', e.transform))
  svg.call(zoom)

  const link = g.append('g').selectAll('line').data(edges).join('line')
    .attr('stroke', (d) => QUIET.has(d.p) ? '#b7c0cc' : HIERARCHY.has(d.p) ? '#4f7cc0' : '#7a8696')
    .attr('stroke-width', (d) => HIERARCHY.has(d.p) ? 2 : 1.3)
    .attr('stroke-dasharray', (d) => HIERARCHY.has(d.p) ? null : QUIET.has(d.p) ? '2,5' : '5,3')
    .attr('marker-end', (d) => QUIET.has(d.p) ? null : 'url(#arrow)')
  const elabel = g.append('g').selectAll('text').data(edgeLabels ? edges.filter((d) => !QUIET.has(d.p)) : []).join('text')
    .attr('font-size', 9.5).attr('font-family', 'ui-monospace, monospace').attr('text-anchor', 'middle').attr('opacity', 0.75)
    .text((d) => compact(d.p).replace(/^[^:]*:/, ''))
  const node = g.append('g').selectAll('g').data(nodes).join('g').style('cursor', 'grab')
  node.append('circle').attr('r', (d) => ['Scheme', 'Class', 'Ontology'].includes(d.kind) ? 8 : 6)
    .attr('fill', (d) => COLORS[d.kind]).attr('stroke', '#fff').attr('stroke-width', 1.5).attr('opacity', (d) => d.faded ? 0.4 : 1)
  node.append('text').attr('x', 10).attr('y', 4).attr('font-size', 11).attr('opacity', (d) => d.faded ? 0.5 : 1).text((d) => d.label)

  node.on('click', (e, d) => {
    e.stopPropagation()
    const rows = quads.filter((q) => q.subject.value === d.id).slice(0, 18)
      .map((q) => `<div><span class="mono">${esc(compact(q.predicate.value))}</span> ${esc(q.object.termType === 'Literal' ? q.object.value : compact(q.object.value))}</div>`).join('')
    infoEl.innerHTML = `<b>${esc(d.label)}</b> <span class="pill">${d.kind}</span><div class="mono muted" style="margin:4px 0 6px;word-break:break-all">${esc(d.id)}</div>${rows}`
    infoEl.style.display = 'block'
  })
  svg.on('click', () => { infoEl.style.display = 'none' })

  if (sim) sim.stop()
  sim = d3.forceSimulation(nodes)
    .force('charge', d3.forceManyBody().strength(-220))
    .force('link', d3.forceLink(edges).id((d) => d.id).distance((d) => QUIET.has(d.p) ? 90 : 75).strength((d) => QUIET.has(d.p) ? 0.2 : 0.6))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('x', d3.forceX(W / 2).strength(0.05)).force('y', d3.forceY(H / 2).strength(0.05))
    .force('collide', d3.forceCollide(20))
  sim.on('tick', () => {
    link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y)
    elabel.attr('x', (d) => (d.source.x + d.target.x) / 2).attr('y', (d) => (d.source.y + d.target.y) / 2 - 3)
    node.attr('transform', (d) => `translate(${d.x},${d.y})`)
  })
  const fit = () => {
    if (!svgEl.isConnected) return
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y)
    if (xs.some((x) => !isFinite(x))) return
    const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 140, y0 = Math.min(...ys) - 30, y1 = Math.max(...ys) + 30
    const k = Math.min(W / (x1 - x0), H / (y1 - y0), 1.6)
    svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity.translate((W - k * (x0 + x1)) / 2, (H - k * (y0 + y1)) / 2).scale(k))
  }
  // fit once the layout has mostly settled, and again when it stops
  sim.on('end', fit)
  setTimeout(fit, 1200)
  node.call(d3.drag()
    .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
    .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
    .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null }))

  const legend = svg.append('g').attr('transform', 'translate(12,16)')
  Object.keys(COLORS).filter((k) => nodes.some((n) => n.kind === k)).forEach((k, i) => {
    const r = legend.append('g').attr('transform', `translate(0,${i * 16})`)
    r.append('circle').attr('r', 5).attr('fill', COLORS[k])
    r.append('text').attr('x', 10).attr('y', 4).attr('font-size', 11).text(k)
  })
  return { nodes: nodes.length, edges: edges.length, fit }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}
