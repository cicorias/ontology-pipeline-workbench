import './style.css'
import { loadDb, saveDb, blankProject, newTerm, getPath, setPath, upperId, lowerId, uid } from './state.js'
import { researchExample } from './example.js'
import { NS, DC_ELEMENTS, ENCODINGS, STANDARDS, XSD_TYPES, MATCH_RELS, dcKind } from './vocab.js'
import { buildQuads, shapeQuads, toTurtle, toNTriples, toJsonLd, prefixes, compact, expand, bases, propInfo, rangeKind, propKind, placedTerms, termsInScheme } from './rdf.js'
import { reason } from './reason.js'
import { sparql, validateShacl, oxigraphReady } from './engine.js'
import { runStage, needs, ancestors, descendants } from './checks.js'
import { drawGraph, stopGraph } from './graph.js'

let db = loadDb()
let st = ensureUi(db.projects[db.current])
let lastCheck = null      // results of the ontology Check, kept until the project changes
let lastQuery = null      // the last SPARQL result
let graphFocus = null     // IRIs from a query result to draw on their own
let graphFit = null

const $ = (s) => document.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/* ------------------------------------------------------------ persistence */
let savedTimer
function save() {
  db.projects[db.current] = st
  if (!saveDb(db)) toast('Could not save to browser storage. Export the project to keep your work.')
  const el = $('#saved'); el.classList.add('on'); clearTimeout(savedTimer); savedTimer = setTimeout(() => el.classList.remove('on'), 800)
}
let toastTimer
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600)
}
// toggles that default to on, and fields older project files may lack
function ensureUi(p) {
  p.ui ||= {}
  p.ui.sel ||= {}
  for (const k of ['withInferences', 'gC', 'gT', 'gA']) if (p.ui[k] === undefined) p.ui[k] = true
  if (p.ui.gLabels === undefined) p.ui.gLabels = false
  p.onto.records ||= []
  return p
}
function switchTo(id) { db.current = id; st = ensureUi(db.projects[id]); lastCheck = lastQuery = graphFocus = null; save(); render() }

/* ------------------------------------------------------------ small HTML helpers */
const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(l)}</option>`
const field = (label, hint, inner, cls = '') => `<div class="field ${cls}"><label>${label}${hint ? ` <span class="hint">${esc(hint)}</span>` : ''}</label>${inner}</div>`
const inp = (path, ph = '', extra = '') => `<input data-bind="${path}" value="${esc(getPath(st, path))}" placeholder="${esc(ph)}" ${extra}>`
const area = (path, ph = '', extra = '') => `<textarea data-bind="${path}" placeholder="${esc(ph)}" ${extra}>${esc(getPath(st, path))}</textarea>`
const listInp = (path, ph = 'separate entries with ;') => `<input data-list="${path}" value="${esc((getPath(st, path) || []).join('; '))}" placeholder="${esc(ph)}">`
const select = (path, options, extra = '') => `<select data-bind="${path}" ${extra}>${options.map(([v, l]) => opt(v, l, getPath(st, path))).join('')}</select>`
const check = (path, label, extra = '') => `<label class="check"><input type="checkbox" data-bind="${path}" ${getPath(st, path) ? 'checked' : ''} ${extra}> <span>${label}</span></label>`
const btn = (act, label, arg = '', cls = 'sm') => `<button class="${cls}" data-act="${act}" data-arg="${esc(arg)}">${label}</button>`
const val = (id) => (document.getElementById(id)?.value || '').trim()

const T = () => st.vocab.terms
const O = () => st.onto
const termLabel = (k) => T()[k]?.label || k
const sel = () => (st.ui.sel ||= {})

/* ------------------------------------------------------------ class and property helpers */
function stdClasses() {
  return O().reuse.flatMap((v) => Object.keys(STANDARDS[v]?.classes || {}).map((c) => `${v}:${c}`))
}
function classLabel(ref) { return ref.includes(':') ? ref : (O().classes[ref]?.label || ref) }
function classOptions(cur, { blank = '—', exclude = [], concept = false, datatypes = false } = {}) {
  const ex = new Set(exclude)
  let h = blank !== null ? opt('', blank, cur) : ''
  h += `<optgroup label="This ontology">${Object.keys(O().classes).filter((k) => !ex.has(k)).map((k) => opt(k, classLabel(k), cur)).join('')}</optgroup>`
  const std = stdClasses().filter((k) => !ex.has(k))
  if (std.length) h += `<optgroup label="Reused standards">${std.map((k) => opt(k, k, cur)).join('')}</optgroup>`
  if (concept) h += `<optgroup label="A concept from a scheme">${opt('skos:Concept', 'skos:Concept', cur)}</optgroup>`
  if (datatypes) h += `<optgroup label="Literal values">${XSD_TYPES.map((t) => opt('xsd:' + t, 'xsd:' + t, cur)).join('')}${opt('rdfs:Literal', 'rdfs:Literal', cur)}</optgroup>`
  return h
}
// every class a reference is a subclass of, itself included, as expanded IRIs
function classClosure(refs) {
  const out = new Set(), stack = [...refs]
  while (stack.length) {
    const r = stack.pop()
    if (!r) continue
    const iri = expand(st, r)
    if (out.has(iri)) continue
    out.add(iri)
    if (r.includes(':')) { const [v, l] = r.split(':'); const sup = STANDARDS[v]?.classes[l]; if (sup) stack.push(sup) } else (O().classes[r]?.sub || []).forEach((s) => stack.push(s))
  }
  return out
}
function propsFor(ind) {
  const anc = classClosure(ind.types)
  const fits = (domain) => !domain || anc.has(expand(st, domain))
  const out = []
  for (const k of Object.keys(O().props)) if (fits(O().props[k].domain)) out.push(k)
  for (const n of Object.keys(st.profile.elements)) out.push('dct:' + n)
  for (const v of O().reuse) for (const [l, [d]] of Object.entries(STANDARDS[v]?.props || {})) if (fits(d)) out.push(`${v}:${l}`)
  return out
}
function propLabel(ref) { const i = propInfo(st, ref); return i?.source === 'own' ? i.label : ref }
function individualsOf(range) {
  const target = expand(st, range)
  return Object.keys(O().individuals).filter((k) => classClosure(O().individuals[k].types).has(target))
}
function valueText(v) {
  if (v.k === 'ind') return O().individuals[v.v]?.label || v.v
  if (v.k === 'concept') return termLabel(v.v)
  return v.v
}

/* ------------------------------------------------------------ navigation */
const STAGES = [
  ['home', '≡', 'Overview'], ['vocab', '1', 'Controlled vocabulary'], ['profile', '2', 'Metadata profile'], ['taxonomy', '3', 'Taxonomy'],
  ['thesaurus', '4', 'Thesaurus'], ['ontology', '5', 'Ontology'], ['kg', '6', 'Knowledge graph'], ['rdf', '{ }', 'RDF'],
]
const STAGE_NUM = { vocab: 1, profile: 2, taxonomy: 3, thesaurus: 4, ontology: 5, kg: 6 }

function renderNav() {
  const n = needs(st)
  $('#nav').innerHTML = STAGES.map(([v, num, label]) => {
    const s = STAGE_NUM[v], open = s && n[s].length
    return `<button data-act="go" data-arg="${v}" class="${st.ui.view === v ? 'on' : ''} ${s && !open ? 'done' : ''}"><span class="n">${num}</span>${label}${open ? '<span class="dot" title="still needs work"></span>' : ''}</button>`
  }).join('')
  $('#projectPick').innerHTML = Object.entries(db.projects).map(([id, p]) => opt(id, p.title, db.current)).join('')
}

function nextLine(stage) {
  const n = needs(st)[stage]
  if (!n.length) return `<div class="next ok"><b>Ready.</b><span>${stage <= 4 ? 'This stage has what the next one needs. Run its checklist below for the finer points.' : stage === 5 ? 'Schema and test data are in place. Run Check to reason over them.' : 'Every competency question has a query.'}</span>${stage < 6 ? `<button class="sm primary" data-act="go" data-arg="${STAGES[stage + 1][0]}">Continue to ${STAGES[stage + 1][2]} →</button>` : ''}</div>`
  return `<div class="next"><b>Next:</b><span>add ${esc(n[0])}${n.length > 1 ? ` <span class="muted">(+${n.length - 1} more)</span>` : ''}.</span></div>`
}

function checklistPanel(stage) {
  const res = st.ui['check' + stage]
  return `<div class="panel"><h3>Checklist <small>quality rules for this stage</small></h3>
    <button class="primary" data-act="runStage" data-arg="${stage}">Run the checklist</button>
    <div class="checklist" style="margin-top:10px">${res ? checklistHtml(runStage(st, stage)) : '<span class="muted">Not run yet.</span>'}</div></div>`
}
function checklistHtml(items) {
  return items.map((it) => {
    const sev = it.findings.some((f) => f.sev === 'error') ? 'error' : it.findings.length ? 'warning' : 'ok'
    return `<div class="item ${sev}"><span class="mark">${sev === 'ok' ? '✓' : sev === 'error' ? '✕' : '!'}</span><div>${esc(it.text)}${it.findings.map((f) => `<div class="f ${f.sev}">${esc(f.msg)}${f.where ? `<span class="where">${esc(f.where)}</span>` : ''}</div>`).join('')}</div></div>`
  }).join('')
}

/* ------------------------------------------------------------ overview */
function viewHome() {
  const n = needs(st)
  const rows = [1, 2, 3, 4, 5, 6].map((s) => {
    const [v, , label] = STAGES[s]
    return `<div class="item"><span class="pill ${n[s].length ? 'warn' : 'ok'}">${n[s].length ? 'open' : 'ready'}</span><div class="what"><b>${s} · ${label}</b>${n[s].length ? `<div class="muted">still needs ${esc(n[s].join('; '))}</div>` : ''}</div>${btn('go', 'Open →', v, 'link')}</div>`
  }).join('')
  return `<h2>${esc(st.title)}</h2>
  <p class="lead">Six stages, each building on the last: agree on words, describe records, arrange the words in a hierarchy, enrich them with relations and mappings, formalize classes and properties with test data, then query and draw the result as a knowledge graph. Everything runs in this browser and is saved here; export the RDF or the project file to keep it elsewhere.</p>
  <div class="panel progress"><h3>Progress</h3>${rows}</div>
  <div class="panel"><h3>About this project</h3>
    ${field('Project title', '', inp('title', '', 'data-rerender'))}
    ${field('Domain', 'what the knowledge graph describes', area('about.domain'))}
    ${field('Purpose', 'what it is for, and for whom', area('about.purpose'))}
    ${field('Steward', 'who keeps it healthy', inp('about.steward'))}
  </div>
  <p class="foot">Ontology Workbench runs offline. SPARQL is answered by <a href="https://github.com/oxigraph/oxigraph">Oxigraph</a> compiled to WebAssembly, SHACL by <a href="https://github.com/zazuko/rdf-validate-shacl">rdf-validate-shacl</a>, Turtle by <a href="https://github.com/rdfjs/N3.js">N3.js</a>, the graph by <a href="https://d3js.org">d3</a>.</p>`
}

/* ------------------------------------------------------------ stage 1: controlled vocabulary */
function viewVocab() {
  const v = st.vocab, k = sel().term, t = T()[k]
  const q = (sel().termFilter || '').toLowerCase()
  const ids = Object.keys(T()).filter((x) => !q || (T()[x].label + ' ' + T()[x].alt.join(' ')).toLowerCase().includes(q)).sort((a, b) => termLabel(a).localeCompare(termLabel(b)))
  return `<h2><span class="tag" style="background:var(--s1)">Stage 1</span>Controlled vocabulary</h2>
  <p class="lead">The approved words: one preferred label per concept, the variants people actually use, a definition, and where each term came from.</p>
  ${nextLine(1)}
  <div class="panel"><h3>Purpose and scope</h3>
    ${field('Purpose', 'what decisions the vocabulary supports', area('vocab.purpose'))}
    <div class="row">${field('In scope', '', inp('vocab.inScope'))}${field('Out of scope', 'naming it stops the sprawl', inp('vocab.outScope'))}</div>
  </div>
  <div class="panel"><h3>Sources <small>where the words come from</small></h3>
    <div class="chips">${v.sources.map((s, i) => `<span class="chip">${esc(s.name)}${s.kind ? ` <span class="muted">· ${esc(s.kind)}</span>` : ''}<button data-act="rmSource" data-arg="${i}" title="remove">✕</button></span>`).join('') || '<span class="muted">None yet.</span>'}</div>
    <div class="adder"><input id="srcName" placeholder="Source, e.g. support tickets"><input id="srcKind" placeholder="Kind: content, search log, interview, standard"><button class="sm" data-act="addSource">Add source</button></div>
  </div>
  <div class="panel"><h3>Terms <small>${Object.keys(T()).length} in total, ${Object.values(T()).filter((x) => x.status === 'approved').length} approved</small></h3>
    <div class="split"><div>
      <div class="adder" style="margin:0 0 8px"><input id="termNew" placeholder="New candidate term" data-enter="addTerm"><button class="sm" data-act="addTerm">Add</button></div>
      <input data-bind="ui.sel.termFilter" data-live="vocab" placeholder="filter" value="${esc(sel().termFilter)}" style="margin-bottom:8px">
      <div class="list">${ids.map((x) => `<div class="it ${x === k ? 'sel' : ''}" data-act="pick" data-arg="term:${x}">${esc(termLabel(x))}<span class="meta">${T()[x].status}${T()[x].definition ? '' : ' · no def'}</span></div>`).join('') || '<div class="empty">No terms.</div>'}</div>
    </div><div>${t ? termEditor(k, t) : '<div class="editor muted">Pick a term or add one.</div>'}</div></div>
  </div>
  ${checklistPanel(1)}`
}
function termEditor(k, t) {
  const p = `vocab.terms.${k}`
  return `<div class="editor"><h4>${esc(t.label)} <span class="pill">${esc(k)}</span></h4>
    <div class="row">${field('Preferred label', 'skos:prefLabel', inp(p + '.label', '', 'data-rerender'))}
      ${field('Status', '', select(p + '.status', [['candidate', 'candidate'], ['approved', 'approved'], ['deprecated', 'deprecated']], 'data-rerender'), 'narrow')}</div>
    ${t.status === 'deprecated' ? field('Replaced by', 'dct:isReplacedBy', select(p + '.replacedBy', [['', '—'], ...Object.keys(T()).filter((x) => x !== k).map((x) => [x, termLabel(x)])])) : ''}
    ${field('Alternative labels', 'skos:altLabel · synonyms, acronyms, spellings people use', listInp(p + '.alt'))}
    ${field('Definition', 'X is a [broader kind] that [what sets it apart]', area(p + '.definition'))}
    <div class="row">${field('Source', '', select(p + '.source', [['', '—'], ...st.vocab.sources.map((s) => [s.name, s.name])]))}${field('Owner', 'who decides about this term', inp(p + '.owner'))}</div>
    <button class="sm danger" data-act="delTerm" data-arg="${k}">Delete term</button></div>`
}

/* ------------------------------------------------------------ stage 2: metadata profile */
function viewProfile() {
  const P = st.profile, on = Object.keys(P.elements)
  const rows = on.map((n) => {
    const e = P.elements[n], base = `profile.elements.${n}`
    const schemes = e.encoding === 'vocab' ? `<div class="chips" style="margin-top:4px">${Object.keys(st.schemes).map((s) => `<label class="check"><input type="checkbox" data-act="toggleElScheme" data-arg="${n}:${s}" ${(e.schemes || []).includes(s) ? 'checked' : ''}> ${esc(st.schemes[s].title)}</label>`).join('') || '<span class="muted">Build a scheme in stage 3 first.</span>'}</div>` : ''
    return `<tr><td><b>${esc(DC_ELEMENTS.find((d) => d[0] === n)?.[1] || n)}</b><div class="mono muted">dct:${n}</div></td>
      <td>${select(base + '.obligation', [['required', 'required'], ['recommended', 'recommended'], ['optional', 'optional']])}</td>
      <td>${select(base + '.max', [['1', '1'], ['many', 'many']])}</td>
      <td>${select(base + '.encoding', Object.entries(ENCODINGS), 'data-rerender')}${schemes}</td>
      <td><textarea data-bind="${base}.guideline">${esc(e.guideline)}</textarea></td>
      <td>${inp(base + '.example')}</td><td>${btn('rmElement', '✕', n, 'rm')}</td></tr>`
  }).join('')
  const xw = P.systems.length ? `<table class="grid"><tr><th>element</th>${P.systems.map((s, i) => `<th>${esc(s)} ${btn('rmSystem', '✕', i, 'rm')}</th>`).join('')}</tr>
    ${on.map((n) => `<tr><td class="mono">dct:${n}</td>${P.systems.map((s) => `<td><input data-xwalk="${n}" data-sys="${esc(s)}" value="${esc((P.crosswalk[n] || {})[s])}" placeholder="field in ${esc(s)}"></td>`).join('')}</tr>`).join('')}</table>` : '<p class="muted">Add the systems that hold these records; each element then gets a row mapping it to their fields.</p>'
  return `<h2><span class="tag" style="background:var(--s2)">Stage 2</span>Metadata application profile</h2>
  <p class="lead">Which Dublin Core elements every record carries, whether each is required, how often it may appear, how values are written, and which field holds it in each system.</p>
  ${nextLine(2)}
  <div class="panel"><h3>Profile</h3><div class="row">${field('Title', '', inp('profile.title'))}${field('Applies to', 'the kind of thing records describe', inp('profile.appliesTo'))}</div></div>
  <div class="panel"><h3>Elements</h3><div class="scroll-x"><table class="grid"><tr><th>element</th><th>obligation</th><th>max</th><th>encoding</th><th>input guideline</th><th>example</th><th></th></tr>${rows || '<tr><td colspan="7" class="muted">No elements yet. Title and identifier are the usual start.</td></tr>'}</table></div>
    <div class="adder"><select id="elAdd">${opt('', '— add a Dublin Core element —')}${DC_ELEMENTS.filter(([n]) => !P.elements[n]).map(([n, l]) => opt(n, `${l} (dct:${n})`)).join('')}</select><button class="sm" data-act="addElement">Add element</button></div>
  </div>
  <div class="panel"><h3>Crosswalk <small>where each element lives in each system</small></h3>${xw}
    <div class="adder"><input id="sysNew" placeholder="System, e.g. CMS" data-enter="addSystem"><button class="sm" data-act="addSystem">Add system</button></div></div>
  ${checklistPanel(2)}`
}

/* ------------------------------------------------------------ stage 3 and 4: the concept tree */
function tree(pickAct) {
  const rows = []
  for (const sid of Object.keys(st.schemes)) {
    rows.push(`<div class="it head" ${pickAct === 'tax' ? `data-act="pick" data-arg="scheme:${sid}" style="cursor:pointer"` : ''}>${esc(st.schemes[sid].title)}<span class="meta">${termsInScheme(st, sid).length}</span></div>`)
    const kids = (p) => termsInScheme(st, sid).filter((k) => T()[k].broader === p).sort((a, b) => termLabel(a).localeCompare(termLabel(b)))
    const tops = termsInScheme(st, sid).filter((k) => !T()[k].broader || T()[T()[k].broader]?.scheme !== sid)
    const walk = (k, depth) => {
      const t = T()[k]
      rows.push(`<div class="it ${sel().concept === k ? 'sel' : ''}" style="padding-left:${12 + depth * 16}px" data-act="pick" data-arg="concept:${k}">${esc(t.label)}<span class="meta">${t.broader ? (t.isa ? 'is-a ✓' : 'is-a ?') : 'top'}${t.related.length ? ' · rel' : ''}${t.matches.length ? ' · map' : ''}</span></div>`)
      if (depth < 8) kids(k).forEach((c) => walk(c, depth + 1))
    }
    tops.sort((a, b) => termLabel(a).localeCompare(termLabel(b))).forEach((k) => walk(k, 0))
  }
  return `<div class="list">${rows.join('') || '<div class="empty">No schemes yet.</div>'}</div>`
}

function viewTaxonomy() {
  const unplaced = Object.keys(T()).filter((k) => T()[k].status === 'approved' && !st.schemes[T()[k].scheme])
  const sid = sel().scheme, k = sel().concept, t = T()[k]
  let editor = '<div class="editor muted">Pick a scheme or a concept.</div>'
  if (sel().pane === 'scheme' && st.schemes[sid]) {
    editor = `<div class="editor"><h4>Scheme <span class="pill">${esc(sid)}</span></h4>
      ${field('Title', 'skos:prefLabel', inp(`schemes.${sid}.title`, '', 'data-rerender'))}
      ${field('Coverage', 'what belongs in this scheme and what does not', area(`schemes.${sid}.description`))}
      <button class="sm danger" data-act="delScheme" data-arg="${sid}">Delete scheme</button></div>`
  } else if (t && st.schemes[t.scheme]) {
    const blocked = new Set([k, ...descendants(st, k)])
    const parents = termsInScheme(st, t.scheme).filter((x) => !blocked.has(x))
    editor = `<div class="editor"><h4>${esc(t.label)} <span class="pill">${esc(k)}</span></h4>
      <div class="row">${field('Scheme', 'skos:inScheme', select(`vocab.terms.${k}.scheme`, Object.keys(st.schemes).map((s) => [s, st.schemes[s].title]), 'data-rerender data-reset-broader="' + k + '"'))}
      ${field('Broader concept', 'skos:broader · empty for a top concept', select(`vocab.terms.${k}.broader`, [['', '— top concept —'], ...parents.map((x) => [x, termLabel(x)])], 'data-rerender data-reset-isa="' + k + '"'))}</div>
      ${t.broader ? `<div class="field">${check(`vocab.terms.${k}.isa`, `Is-a test: every <b>${esc(t.label)}</b> is a kind of <b>${esc(termLabel(t.broader))}</b>. (Part-of belongs in the thesaurus or the ontology.)`, 'data-rerender')}</div>` : ''}
      ${field('Definition', 'from stage 1; revise it if the parent changes the broader kind', area(`vocab.terms.${k}.definition`))}
      <p class="muted">Level ${ancestors(st, k).length + 1}. Alternative labels: ${esc(t.alt.join(', ') || 'none')}.</p>
      ${btn('unplace', 'Remove from the scheme', k)}</div>`
  }
  return `<h2><span class="tag" style="background:var(--s3)">Stage 3</span>Taxonomy</h2>
  <p class="lead">Arrange the approved terms into concept schemes. Every parent-child link must pass the is-a test: the child is a kind of the parent.</p>
  ${nextLine(3)}
  <div class="panel"><h3>Schemes and hierarchy</h3><div class="split"><div>
    <div class="adder" style="margin:0 0 8px"><input id="schemeNew" placeholder="New scheme, e.g. Product lines" data-enter="addScheme"><button class="sm" data-act="addScheme">Add scheme</button></div>
    ${tree('tax')}
    <div style="margin-top:10px"><label>Approved, not yet placed</label><div class="chips">${unplaced.map((u) => `<span class="chip">${esc(termLabel(u))}<button data-act="place" data-arg="${u}" title="place in ${esc(st.schemes[sid]?.title || 'the first scheme')}">+</button></span>`).join('') || '<span class="pill ok">all placed</span>'}</div>
    <div class="muted">+ places a term in the selected scheme (${esc(st.schemes[sid]?.title || Object.values(st.schemes)[0]?.title || 'none')}).</div></div>
  </div><div>${editor}</div></div></div>
  ${checklistPanel(3)}`
}

function viewThesaurus() {
  const k = sel().concept, t = T()[k]
  let editor = '<div class="editor muted">Pick a concept in the tree.</div>'
  if (t && st.schemes[t.scheme]) {
    const hier = new Set([k, ...ancestors(st, k), ...descendants(st, k)])
    const p = `vocab.terms.${k}`
    editor = `<div class="editor"><h4>${esc(t.label)} <span class="pill">${esc(st.schemes[t.scheme].title)}</span></h4>
      ${field('Related concepts', 'skos:related · associative, both ways, never inside its own hierarchy', `<div class="chips">${t.related.map((r) => `<span class="chip c">${esc(termLabel(r))}<button data-act="rmRelated" data-arg="${k}:${r}">✕</button></span>`).join('') || '<span class="muted">none</span>'}</div>
        <div class="adder"><select id="relAdd">${opt('', '—')}${placedTerms(st).filter((x) => !hier.has(x) && !t.related.includes(x)).map((x) => opt(x, termLabel(x))).join('')}</select><button class="sm" data-act="addRelated" data-arg="${k}">Add</button></div>`)}
      ${field('Scope note', 'skos:scopeNote · where the boundary lies', area(p + '.scopeNote'))}
      <div class="row">${field('Example', 'skos:example', inp(p + '.example'))}${field('Notation', 'skos:notation · a code', inp(p + '.notation'), 'narrow')}</div>
      ${field('Hidden labels', 'skos:hiddenLabel · misspellings found in search logs', listInp(p + '.hidden'))}
      ${field('Mappings', 'to outside vocabularies: Wikidata, DBpedia, an industry standard', `<div class="chips">${t.matches.map((m, i) => `<span class="chip"><span class="mono">${m.rel}</span> ${esc(m.uri)}<button data-act="rmMatch" data-arg="${k}:${i}">✕</button></span>`).join('') || '<span class="muted">none</span>'}</div>
        <div class="adder"><select id="matchRel" style="flex:0 0 140px">${MATCH_RELS.map((r) => opt(r, r, 'closeMatch')).join('')}</select><input id="matchUri" placeholder="https://www.wikidata.org/entity/Q…"><button class="sm" data-act="addMatch" data-arg="${k}">Add</button></div>`)}
    </div>`
  }
  const cols = Object.entries(st.collections).map(([id, c]) => `<div class="panel" style="margin:8px 0"><h3>${esc(c.label)} <span class="pill">${c.ordered ? 'ordered' : 'unordered'}</span> ${btn('delCollection', 'delete', id, 'rm')}</h3>
    <div class="chips">${c.members.map((m, i) => `<span class="chip c">${c.ordered ? i + 1 + '. ' : ''}${esc(termLabel(m))}<button data-act="rmMember" data-arg="${id}:${i}">✕</button></span>`).join('')}</div>
    <div class="adder"><select id="mem-${id}">${opt('', '— add a member —')}${placedTerms(st).filter((x) => !c.members.includes(x)).map((x) => opt(x, termLabel(x))).join('')}</select><button class="sm" data-act="addMember" data-arg="${id}">Add</button></div></div>`).join('')
  return `<h2><span class="tag" style="background:var(--s4)">Stage 4</span>Thesaurus</h2>
  <p class="lead">Add what a hierarchy cannot say: associative links, scope notes, hidden search forms, and mappings to vocabularies outside this one. Collections group concepts for display without changing the hierarchy.</p>
  ${nextLine(4)}
  <div class="panel"><h3>Concepts</h3><div class="split"><div>${tree('thes')}</div><div>${editor}</div></div></div>
  <details class="panel"><summary>Collections (${Object.keys(st.collections).length})</summary>${cols || '<p class="muted">None.</p>'}
    <div class="adder"><input id="colNew" placeholder="Collection label"><label class="check"><input type="checkbox" id="colOrdered"> ordered</label><button class="sm" data-act="addCollection">Add collection</button></div></details>
  ${checklistPanel(4)}`
}

/* ------------------------------------------------------------ stage 5: ontology */
function viewOntology() {
  const tab = st.ui.ontoTab || 'cbox'
  const tabs = [['cbox', '1 · CBox: questions and governance'], ['tbox', '2 · TBox: classes, properties, shapes'], ['abox', '3 · ABox: test individuals'], ['check', '✓ Check']]
  const body = { cbox: ontoCbox, tbox: ontoTbox, abox: ontoAbox, check: ontoCheck }[tab]()
  return `<h2><span class="tag" style="background:var(--s5)">Stage 5</span>Ontology</h2>
  <p class="lead">Competency questions first, then the schema, then a small set of test individuals that exercises every class and property. The Check reasons over them and validates the shapes.</p>
  ${nextLine(5)}
  <div class="subtabs">${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="ontoTab" data-arg="${k}">${l}</button>`).join('')}</div>${body}`
}

function ontoCbox() {
  const o = O()
  return `<div class="panel"><h3>Competency questions <small>each becomes a SPARQL query in stage 6</small></h3>
    ${o.cqs.map((q, i) => `<div class="row" style="align-items:center"><span class="pill">CQ ${i + 1}</span><div class="field" style="flex:1;margin:0">${inp(`onto.cqs.${i}.text`)}</div><span class="pill ${q.sparql ? 'ok' : 'warn'}">${q.sparql ? 'has query' : 'no query'}</span>${btn('rmCq', '✕', i, 'rm')}</div>`).join('<div style="height:6px"></div>') || '<p class="muted">None yet. Start with the questions the graph must answer.</p>'}
    <div class="adder"><input id="cqNew" placeholder="e.g. Which suppliers deliver parts for a product line?" data-enter="addCq"><button class="sm" data-act="addCq">Add question</button></div></div>
  <div class="panel"><h3>Namespaces <small>concepts, schema and instances kept apart</small></h3>
    ${['concept', 'schema', 'data'].map((b) => `<div class="row">${field({ concept: 'Concept namespace (CBox)', schema: 'Schema namespace (TBox)', data: 'Instance namespace (ABox)' }[b], 'ends in # or /', inp(`onto.base.${b}`, b === 'schema' ? 'https://example.org/my/schema#' : `https://example.org/my/${b}/`))}${field('Prefix', '', inp(`onto.prefix.${b}`), 'narrow')}</div>`).join('')}
  </div>
  <div class="panel"><h3>The ontology record <small>owl:Ontology with Dublin Core</small></h3>
    <div class="row">${field('Title', 'dct:title', inp('onto.title'))}${field('Version', 'owl:versionInfo', inp('onto.version'), 'narrow')}</div>
    ${field('Description', 'dct:description', area('onto.description'))}
    <div class="row">${field('Creator', 'dct:creator', inp('onto.creator'))}${field('License', 'dct:license · an IRI', inp('onto.license'))}</div></div>
  <div class="panel"><h3>Standards to reuse <small>before defining your own terms</small></h3>
    ${Object.entries(STANDARDS).map(([k, s]) => `<label class="check" style="display:flex;margin:4px 0"><input type="checkbox" data-act="toggleReuse" data-arg="${k}" ${O().reuse.includes(k) ? 'checked' : ''}> <b>${s.label}</b> <span class="muted">${esc(s.about)} ${Object.keys(s.classes).length} classes, ${Object.keys(s.props).length} properties.</span></label>`).join('')}</div>`
}

function ontoTbox() {
  const o = O(), ck = sel().cls, c = o.classes[ck], pk = sel().prop, p = o.props[pk], sk = sel().shape, sh = o.shapes[sk]
  const cqOpts = [['', '—'], ...o.cqs.map((q, i) => [q.id, `CQ ${i + 1}: ${q.text.slice(0, 60)}`])]
  const clsEd = c ? `<div class="editor"><h4>Class <span class="pill">${esc(o.prefix.schema || 't')}:${esc(ck)}</span></h4>
    ${field('Label', 'rdfs:label', inp(`onto.classes.${ck}.label`, '', 'data-rerender'))}
    ${field('Comment', 'rdfs:comment · write the definition before the axioms', area(`onto.classes.${ck}.comment`))}
    ${field('Subclass of', 'rdfs:subClassOf', `<div class="chips">${c.sub.map((s) => `<span class="chip t">${esc(classLabel(s))}<button data-act="rmSub" data-arg="${ck}:${s}">✕</button></span>`).join('') || '<span class="muted">a root class</span>'}</div>
      <div class="adder"><select id="subAdd">${classOptions('', { exclude: [ck, ...c.sub] })}</select><button class="sm" data-act="addSub" data-arg="${ck}">Add</button></div>`)}
    ${field('Disjoint with', 'owl:disjointWith · nothing can be both', `<div class="chips">${c.disjoint.map((s) => `<span class="chip">${esc(classLabel(s))}<button data-act="rmDisjoint" data-arg="${ck}:${s}">✕</button></span>`).join('') || '<span class="muted">none</span>'}</div>
      <div class="adder"><select id="disAdd">${opt('', '—')}${Object.keys(o.classes).filter((x) => x !== ck && !c.disjoint.includes(x)).map((x) => opt(x, classLabel(x))).join('')}</select><button class="sm" data-act="addDisjoint" data-arg="${ck}">Add</button></div>`)}
    <div class="row">${field('Promoted from concept', 'skos:exactMatch', select(`onto.classes.${ck}.fromConcept`, [['', '—'], ...placedTerms(st).map((x) => [x, termLabel(x)])]))}${field('Serves question', '', select(`onto.classes.${ck}.cq`, cqOpts))}</div>
    <label class="check">${`<input type="checkbox" data-act="toggleRecord" data-arg="${ck}" ${o.records.includes(ck) ? 'checked' : ''}>`} Records of this class follow the stage 2 profile</label>
    <div style="margin-top:10px">${btn('delClass', 'Delete class', ck, 'sm danger')}</div></div>` : '<div class="editor muted">Pick a class, add one, or promote a concept.</div>'
  const prEd = p ? `<div class="editor"><h4>Property <span class="pill">${esc(o.prefix.schema || 't')}:${esc(pk)}</span> <span class="muted mono">${propKind(st, p) ? 'owl:' + propKind(st, p) : 'set a range'}</span></h4>
    ${field('Label', 'rdfs:label', inp(`onto.props.${pk}.label`, '', 'data-rerender'))}
    ${field('Comment', 'rdfs:comment', area(`onto.props.${pk}.comment`))}
    <div class="row">${field('Domain', 'rdfs:domain', `<select data-bind="onto.props.${pk}.domain" data-rerender>${classOptions(p.domain)}</select>`)}
      ${field('Range', 'rdfs:range', `<select data-bind="onto.props.${pk}.range" data-rerender>${classOptions(p.range, { concept: true, datatypes: true })}</select>`)}</div>
    ${p.range === 'skos:Concept' ? '<p class="muted">Values are concepts from a scheme. The concept stays in the CBox and never becomes a class: the right route for statuses, tags and categories.</p>' : ''}
    <div class="row" style="align-items:center">${check(`onto.props.${pk}.functional`, 'functional <span class="muted">(one value at most)</span>')}
      ${propKind(st, p) === 'ObjectProperty' ? check(`onto.props.${pk}.transitive`, 'transitive <span class="muted">(chains collapse)</span>') : ''}</div>
    <div class="row">${propKind(st, p) === 'ObjectProperty' ? field('Inverse of', 'owl:inverseOf', `<select data-act-change="setInverse" data-arg="${pk}">${opt('', '—', p.inverse)}${Object.keys(o.props).filter((x) => x !== pk && propKind(st, o.props[x]) === 'ObjectProperty').map((x) => opt(x, o.props[x].label || x, p.inverse)).join('')}</select>`) : ''}
      ${field('Subproperty of', 'rdfs:subPropertyOf', select(`onto.props.${pk}.sub`, [['', '—'], ...Object.keys(o.props).filter((x) => x !== pk).map((x) => [x, o.props[x].label || x]), ...o.reuse.flatMap((v) => Object.keys(STANDARDS[v]?.props || {}).map((l) => [`${v}:${l}`, `${v}:${l}`]))]))}
      ${field('Serves question', '', select(`onto.props.${pk}.cq`, cqOpts))}</div>
    ${btn('delProp', 'Delete property', pk, 'sm danger')}</div>` : '<div class="editor muted">Pick a property or add one.</div>'
  const pathOpts = (cur) => opt('', '—', cur) + Object.keys(o.props).map((x) => opt(x, o.props[x].label || x, cur)).join('') + Object.keys(st.profile.elements).map((n) => opt('dct:' + n, 'dct:' + n, cur)).join('')
  const shEd = sh ? `<div class="editor"><h4>Shape <span class="pill">${esc(sk)}</span> <span class="muted mono">sh:NodeShape</span></h4>
    <div class="row">${field('Applies to', 'sh:targetClass', `<select data-bind="onto.shapes.${sk}.target" data-rerender>${classOptions(sh.target)}</select>`)}</div>
    <div class="row">${field('Path', 'sh:path · first step', `<select data-act-change="setPath" data-arg="${sk}:0">${pathOpts(sh.path[0])}</select>`)}${field('then', 'optional second step', `<select data-act-change="setPath" data-arg="${sk}:1">${pathOpts(sh.path[1])}</select>`)}</div>
    <div class="row">${field('Values must be of class', 'sh:class', `<select data-bind="onto.shapes.${sk}.cls">${classOptions(sh.cls)}</select>`)}
      ${field('or of datatype', 'sh:datatype', select(`onto.shapes.${sk}.datatype`, [['', '—'], ...XSD_TYPES.map((t) => ['xsd:' + t, 'xsd:' + t])]))}</div>
    <div class="row">${field('At least', 'sh:minCount', inp(`onto.shapes.${sk}.min`, '', 'type="number" min="0"'), 'narrow')}${field('At most', 'sh:maxCount', inp(`onto.shapes.${sk}.max`, '', 'type="number" min="0"'), 'narrow')}${field('Must include value', 'sh:hasValue', inp(`onto.shapes.${sk}.hasValue`))}</div>
    ${field('Message', 'sh:message · what a violation means', inp(`onto.shapes.${sk}.message`))}
    ${btn('delShape', 'Delete shape', sk, 'sm danger')}</div>` : '<div class="editor muted">Shapes state the rules OWL cannot: "every paper has exactly one type", "an approver must be a person".</div>'
  const list = (items, kind, cur, meta) => `<div class="list">${items.map((x) => `<div class="it ${x === cur ? 'sel' : ''}" data-act="pick" data-arg="${kind}:${x}">${esc(kind === 'cls' ? classLabel(x) : kind === 'prop' ? o.props[x].label || x : x)}<span class="meta">${esc(meta(x))}</span></div>`).join('') || '<div class="empty">None yet.</div>'}</div>`
  return `<div class="panel"><h3>Classes</h3><div class="split"><div>
      <div class="adder" style="margin:0 0 8px"><input id="clsNew" placeholder="New class, e.g. Supplier" data-enter="addClass"><button class="sm" data-act="addClass">Add</button></div>
      ${list(Object.keys(o.classes), 'cls', ck, (x) => (o.classes[x].sub.length ? '⊑ ' + o.classes[x].sub.map(classLabel).join(', ') : '') + (o.classes[x].comment ? '' : ' · no comment'))}
      <div class="adder"><select id="promote">${opt('', 'Promote a concept to a class…')}${placedTerms(st).filter((x) => !o.classes[x]).map((x) => opt(x, termLabel(x))).join('')}</select><button class="sm" data-act="promote">Promote</button></div>
    </div><div>${clsEd}</div></div></div>
  <div class="panel"><h3>Properties</h3><div class="split"><div>
      <div class="adder" style="margin:0 0 8px"><input id="propNew" placeholder="New property, e.g. suppliesTo" data-enter="addProp"><button class="sm" data-act="addProp">Add</button></div>
      ${list(Object.keys(o.props), 'prop', pk, (x) => { const d = o.props[x]; return (d.range ? '→ ' + classLabel(d.range) : 'no range') + (d.functional ? ' · fn' : '') + (d.transitive ? ' · trans' : '') })}
    </div><div>${prEd}</div></div></div>
  <div class="panel"><h3>Shapes <small>SHACL constraints, checked against the test individuals</small></h3><div class="split"><div>
      <div class="adder" style="margin:0 0 8px"><input id="shapeNew" placeholder="New shape, e.g. SupplierCountry" data-enter="addShape"><button class="sm" data-act="addShape">Add</button></div>
      ${list(Object.keys(o.shapes), 'shape', sk, (x) => o.shapes[x].target ? 'on ' + classLabel(o.shapes[x].target) : 'no target')}
    </div><div>${shEd}</div></div></div>`
}

function ontoAbox() {
  const o = O(), k = sel().ind, d = o.individuals[k]
  let editor = '<div class="editor muted">Pick an individual or create one.</div>'
  if (d) {
    const applicable = propsFor(d)
    const np = applicable.includes(sel().newProp) ? sel().newProp : applicable[0] || ''
    const info = propInfo(st, np)
    let ctl = '<input id="valNew" placeholder="value">'
    if (info) {
      const kind = rangeKind(info.range)
      if (kind === 'ind') ctl = `<select id="valNew">${opt('', `— a ${classLabel(info.range)} —`)}${individualsOf(info.range).filter((x) => x !== k).map((x) => opt(x, o.individuals[x].label || x)).join('')}</select>`
      else if (kind === 'concept') {
        const pool = info.schemes?.length ? placedTerms(st).filter((x) => info.schemes.includes(T()[x].scheme)) : placedTerms(st)
        ctl = `<select id="valNew">${opt('', '— a concept —')}${pool.map((x) => opt(x, `${termLabel(x)} · ${st.schemes[T()[x].scheme].title}`)).join('')}</select>`
      } else if (kind === 'iri') ctl = `<select id="valNewInd" style="flex:0 0 45%">${opt('', '— an individual —')}${Object.keys(o.individuals).filter((x) => x !== k).map((x) => opt(x, o.individuals[x].label || x)).join('')}</select><input id="valNew" placeholder="or an IRI">`
      else ctl = `<input id="valNew" placeholder="${esc(info.range || 'value')}" type="${info.range === 'xsd:date' ? 'date' : /integer|decimal/.test(info.range) ? 'number' : 'text'}">`
    }
    editor = `<div class="editor"><h4>${esc(d.label || k)} <span class="pill">${esc(o.prefix.data || 'a')}:${esc(k)}</span></h4>
      <div class="row">${field('Label', 'rdfs:label', inp(`onto.individuals.${k}.label`, '', 'data-rerender'))}</div>
      ${field('Types', 'rdf:type · a second type is allowed', `<div class="chips">${d.types.map((t) => `<span class="chip a">${esc(classLabel(t))}<button data-act="rmType" data-arg="${k}:${t}">✕</button></span>`).join('')}</div>
        <div class="adder"><select id="typeAdd">${classOptions('', { exclude: d.types })}</select><button class="sm" data-act="addType" data-arg="${k}">Add type</button></div>`)}
      ${field('Comment', 'rdfs:comment', area(`onto.individuals.${k}.comment`))}
      <label>Values</label>
      <table class="grid">${d.vals.map((v, i) => `<tr><td class="mono">${esc(propLabel(v.p))}</td><td>${esc(valueText(v))} <span class="muted">${v.k}</span></td><td>${btn('rmVal', '✕', `${k}:${i}`, 'rm')}</td></tr>`).join('') || '<tr><td class="muted">No values.</td></tr>'}</table>
      <div class="adder"><select data-act-change="pickNewProp" style="flex:0 0 38%">${applicable.map((x) => opt(x, propLabel(x) + (propInfo(st, x)?.range ? ' → ' + classLabel(propInfo(st, x).range) : ''), np)).join('')}</select>${ctl}<button class="sm" data-act="addVal" data-arg="${k}">Add</button></div>
      <div style="margin-top:10px">${btn('delInd', 'Delete individual', k, 'sm danger')}</div></div>`
  }
  // coverage: classes and properties nothing exercises yet
  const usedC = new Set(), usedP = new Set()
  for (const x of Object.values(o.individuals)) { classClosure(x.types).forEach((c) => usedC.add(c)); x.vals.forEach((v) => usedP.add(v.p)) }
  for (const [pk, p] of Object.entries(o.props)) if (p.inverse && usedP.has(p.inverse)) usedP.add(pk)
  const missC = Object.keys(o.classes).filter((c) => !usedC.has(expand(st, c))), missP = Object.keys(o.props).filter((p) => !usedP.has(p))
  return `<div class="panel"><h3>Test individuals <small>a small, deliberate set that exercises every class and property</small></h3><div class="split"><div>
      <div class="adder" style="margin:0 0 8px"><select id="indCls">${classOptions('', { blank: null })}</select><button class="sm" data-act="addInd">New</button></div>
      <div class="list">${Object.keys(o.individuals).map((x) => `<div class="it ${x === k ? 'sel' : ''}" data-act="pick" data-arg="ind:${x}">${esc(o.individuals[x].label || x)}<span class="meta">${esc(o.individuals[x].types.map(classLabel).join(', '))}</span></div>`).join('') || '<div class="empty">None yet.</div>'}</div>
      <div style="margin-top:10px"><label>Not yet exercised</label><div class="chips">${missC.map((c) => `<span class="pill warn">class ${esc(c)}</span>`).join('')}${missP.map((p) => `<span class="pill warn">property ${esc(p)}</span>`).join('') || (missC.length ? '' : '<span class="pill ok">everything is exercised</span>')}</div></div>
    </div><div>${editor}</div></div></div>`
}

function ontoCheck() {
  const c = lastCheck
  let body = '<p class="muted">Not run yet.</p>'
  if (c?.running) body = '<p class="muted">Reasoning, validating and querying…</p>'
  else if (c) {
    const errs = c.items.reduce((n, it) => n + it.findings.filter((f) => f.sev === 'error').length, 0)
    body = `<p>${errs ? `<span class="pill bad">${errs} error${errs === 1 ? '' : 's'}</span>` : '<span class="pill ok">consistent</span>'} <span class="muted">${c.asserted} asserted triples, ${c.inferred.length} inferred.</span></p>
      <div class="checklist">${checklistHtml(c.items)}</div>
      <details style="margin-top:12px"><summary>Inferred triples about the test individuals (${c.inferredShown.length})</summary>
        <table class="grid">${c.inferredShown.slice(0, 300).map((x) => `<tr><td class="mono">${esc(x.s)}</td><td class="mono">${esc(x.p)}</td><td class="mono">${esc(x.o)}</td><td class="muted">${esc(x.rule)}</td></tr>`).join('')}</table></details>`
  }
  return `<div class="panel"><h3>Check the ontology</h3>
    <p class="muted">Runs the RDFS rules plus inverse, transitive, functional and disjoint axioms over the test individuals, validates every SHACL shape against the result, and runs each competency question's query.</p>
    <button class="primary" data-act="runCheck">Run Check</button><div style="margin-top:12px">${body}</div></div>`
}

async function runCheck() {
  lastCheck = { running: true }; render()
  const o = O()
  const quads = buildQuads(st, 'all')
  const r = reason(quads, { label: (iri) => compact(st, iri) })
  const items = []
  items.push({ text: 'No inconsistency: disjoint classes stay apart, functional properties have one value, values fit their ranges.', findings: r.problems.map((p) => ({ sev: 'error', msg: p.msg })) })
  let shacl = { conforms: true, results: [] }, shaclErr = null
  try { shacl = await validateShacl(shapeQuads(st), r.closure) } catch (e) { shaclErr = e.message }
  items.push({ text: `Every SHACL shape holds (${Object.keys(o.shapes).length} shape${Object.keys(o.shapes).length === 1 ? '' : 's'}).`, findings: shaclErr ? [{ sev: 'error', msg: 'Validation failed to run: ' + shaclErr }] : shacl.results.map((x) => ({ sev: 'error', msg: `${compact(st, x.focus)}: ${x.message || x.component}`, where: x.path ? compact(st, x.path) : '' })) })
  const cqF = []
  for (const [i, q] of o.cqs.entries()) {
    if (!q.sparql.trim()) { cqF.push({ sev: 'warning', msg: `CQ ${i + 1} has no query yet: write it on the Knowledge graph page.` }); continue }
    try { const res = await sparql(r.closure, q.sparql); const n = res.kind === 'select' ? res.rows.length : res.kind === 'ask' ? (res.value ? 1 : 0) : 1; if (!n) cqF.push({ sev: 'error', msg: `CQ ${i + 1} returns nothing: the test set does not exercise it, or the model cannot answer it.`, where: q.text.slice(0, 60) }) } catch (e) { cqF.push({ sev: 'error', msg: `CQ ${i + 1} does not run: ${e.message || e}` }) }
  }
  items.push({ text: 'Every competency question returns an answer over the test individuals (asserted plus inferred triples).', findings: cqF })
  const tb = []
  for (const [k, c] of Object.entries(o.classes)) { if (!c.comment.trim()) tb.push({ sev: 'error', msg: 'Class has no comment.', where: k }); if (!c.cq) tb.push({ sev: 'warning', msg: 'Class serves no competency question.', where: k }) }
  for (const [k, p] of Object.entries(o.props)) { if (!p.domain) tb.push({ sev: 'warning', msg: 'No domain: a reasoner cannot type its subjects.', where: k }); if (!p.range) tb.push({ sev: 'warning', msg: 'No range.', where: k }); if (p.inverse && o.props[p.inverse]?.inverse !== k) tb.push({ sev: 'warning', msg: `Inverse of ${p.inverse}, but not the other way round.`, where: k }) }
  items.push({ text: 'Every class and property is documented, typed, and traceable to a question.', findings: tb })
  const usedC = new Set(r.closure.filter((q) => q.predicate.value === NS.rdf + 'type' && q.subject.value.startsWith(bases(st).data)).map((q) => q.object.value))
  const usedP = new Set(r.closure.filter((q) => q.subject.value.startsWith(bases(st).data)).map((q) => q.predicate.value))
  items.push({ text: 'Every class and property is exercised by a test individual.', findings: [
    ...Object.keys(o.classes).filter((k) => !usedC.has(expand(st, k))).map((k) => ({ sev: 'warning', msg: 'No individual of this class.', where: k })),
    ...Object.keys(o.props).filter((k) => !usedP.has(expand(st, k))).map((k) => ({ sev: 'warning', msg: 'Never used.', where: k })),
  ] })
  // the profile's obligations on the classes it governs
  const pf = []
  for (const [ik, ind] of Object.entries(o.individuals)) {
    if (!o.records.some((rc) => classClosure(ind.types).has(expand(st, rc)))) continue
    for (const [n, e] of Object.entries(st.profile.elements)) {
      const count = ind.vals.filter((v) => v.p === 'dct:' + n).length
      if (e.obligation === 'required' && !count) pf.push({ sev: 'error', msg: `Missing required dct:${n}.`, where: ind.label || ik })
      if (e.max === '1' && count > 1) pf.push({ sev: 'error', msg: `dct:${n} appears ${count} times; the profile allows one.`, where: ind.label || ik })
    }
  }
  items.push({ text: 'Records follow the metadata profile from stage 2.', findings: o.records.length ? pf : [{ sev: 'warning', msg: 'No class is marked as following the profile (TBox → class → "Records of this class…").' }] })
  const data = bases(st).data
  lastCheck = {
    items, asserted: quads.length, inferred: r.inferred,
    inferredShown: r.inferred.filter((x) => x.quad.subject.value.startsWith(data)).map((x) => ({ s: compact(st, x.quad.subject.value), p: compact(st, x.quad.predicate.value), o: x.quad.object.termType === 'Literal' ? x.quad.object.value : compact(st, x.quad.object.value), rule: x.rule })),
  }
  render()
}

/* ------------------------------------------------------------ stage 6: knowledge graph */
function presets() {
  const P = prefixes(st)
  const head = Object.entries(P).filter(([k]) => ['rdf', 'rdfs', 'owl', 'skos', 'dct', ...O().reuse, ...Object.values(O().prefix)].includes(k)).map(([k, v]) => `PREFIX ${k}: <${v}>`).join('\n') + '\n\n'
  const list = O().cqs.map((q, i) => ({ id: q.id, label: `CQ ${i + 1}: ${q.text}`, q: q.sparql || head + `# ${q.text}\n# Write the query that answers it, then "Save to question".\nSELECT ?s ?p ?o WHERE {\n  ?s ?p ?o .\n} LIMIT 25` }))
  list.push(
    { label: 'All concepts with scheme and definition', q: head + 'SELECT ?concept ?label ?scheme ?definition WHERE {\n  ?concept a skos:Concept ; skos:prefLabel ?label ; skos:inScheme ?scheme .\n  OPTIONAL { ?concept skos:definition ?definition }\n} ORDER BY ?label' },
    { label: 'Concept hierarchy (skos:broader+)', q: head + 'SELECT ?concept ?ancestor WHERE {\n  ?c skos:broader+ ?a .\n  ?c skos:prefLabel ?concept . ?a skos:prefLabel ?ancestor .\n} ORDER BY ?concept' },
    { label: 'Mappings to outside vocabularies', q: head + 'SELECT ?concept ?relation ?target WHERE {\n  ?concept ?relation ?target .\n  VALUES ?relation { skos:exactMatch skos:closeMatch skos:broadMatch skos:narrowMatch skos:relatedMatch }\n}' },
    { label: 'Classes and superclasses', q: head + 'SELECT ?class ?super WHERE {\n  ?class a owl:Class .\n  OPTIONAL { ?class rdfs:subClassOf ?super }\n} ORDER BY ?class' },
    { label: 'Individuals per class', q: head + 'SELECT ?class (COUNT(?i) AS ?n) WHERE {\n  ?i a ?class .\n  ?class a owl:Class .\n} GROUP BY ?class ORDER BY DESC(?n)' },
    { label: 'Individuals pointing at concepts', q: head + 'SELECT ?individual ?property ?concept WHERE {\n  ?individual ?property ?concept .\n  ?concept a skos:Concept .\n  FILTER(STRSTARTS(STR(?individual), STR(' + (O().prefix.data ? O().prefix.data + ':' : '<' + bases(st).data + '>') + ')))\n}' },
    { label: 'Everything about one thing (DESCRIBE-style)', q: head + 'SELECT ?p ?o WHERE {\n  ?s ?p ?o .\n  FILTER(?s = <' + (bases(st).data + (Object.keys(O().individuals)[0] || 'x')) + '>)\n}' },
  )
  return list
}

function viewKg() {
  const tab = st.ui.kgTab || 'query'
  const ps = presets()
  if (st.ui.query == null) st.ui.query = ps[0]?.q || ''
  const res = lastQuery
  let table = ''
  if (res?.error) table = `<p><span class="pill bad">error</span> ${esc(res.error)}</p>`
  else if (res?.kind === 'select') table = `<p class="muted">${res.rows.length} row${res.rows.length === 1 ? '' : 's'} in ${res.ms} ms over ${res.triples} triples${res.inferred ? ' (asserted + inferred)' : ''}.
      ${res.rows.some((r) => Object.values(r).some((t) => t.termType === 'NamedNode')) ? `<button class="sm" data-act="drawResult">Draw these results →</button>` : res.rows.length ? '<span class="muted">(only literals in these rows; select the ?things themselves to draw them)</span>' : ''}</p>
    <div class="scroll-x"><table class="grid"><tr>${res.vars.map((v) => `<th>?${esc(v)}</th>`).join('')}</tr>${res.rows.map((r) => `<tr>${res.vars.map((v) => `<td class="mono">${esc(r[v] ? (r[v].termType === 'Literal' ? r[v].value : compact(st, r[v].value)) : '')}</td>`).join('')}</tr>`).join('')}</table></div>`
  else if (res?.kind === 'ask') table = `<p>ASK → <b>${res.value}</b></p>`
  else if (res?.kind === 'graph') table = `<pre class="code">${esc(toTurtle(st, res.quads))}</pre>`
  const query = `<div class="panel">
    <div class="row">${field('Query', 'competency questions first, then ready-made checks', `<select data-act-change="loadPreset">${opt('', '— pick a query —')}${ps.map((p, i) => opt(i, p.label, st.ui.presetIdx)).join('')}</select>`)}</div>
    <textarea class="code" id="qText" data-bind="ui.query" spellcheck="false">${esc(st.ui.query)}</textarea>
    <div class="toolbar" style="margin-top:8px"><button class="primary" data-act="runQuery">Run</button>
      ${check('ui.withInferences', 'include inferred triples (RDFS + OWL rules)')}
      ${ps[st.ui.presetIdx]?.id ? `<button class="sm" data-act="saveCq" data-arg="${ps[st.ui.presetIdx].id}">Save to question</button>` : ''}
      <span class="muted">Full SPARQL 1.1 (Oxigraph): property paths, GROUP BY, HAVING, VALUES, BIND, subqueries, CONSTRUCT, ASK.</span></div>
    <div style="margin-top:8px">${table}</div></div>`
  const graph = `<div class="panel">
    <div class="toolbar">${check('ui.gC', 'CBox', 'data-rerender')}${check('ui.gT', 'TBox', 'data-rerender')}${check('ui.gA', 'ABox', 'data-rerender')}${check('ui.gLabels', 'edge labels', 'data-rerender')}${check('ui.gInf', 'with inferences', 'data-rerender')}
      <button class="sm" data-act="fitGraph">Fit</button><span class="muted mono" id="gStats"></span></div>
    ${graphFocus ? `<div class="next ok"><span>Drawing the ${graphFocus.size} things in the last query result, plus what connects them.</span><button class="sm" data-act="clearFocus">Show everything</button></div>` : ''}
    <div class="graph-wrap"><svg id="gSvg"></svg><div class="node-info" id="gInfo"></div></div>
    <p class="muted">Drag nodes, scroll to zoom, click a node to inspect. Solid blue lines are hierarchy (subClassOf, broader, type); dashed are properties; dotted are scheme membership and definitions.</p></div>`
  return `<h2><span class="tag" style="background:var(--s6)">Stage 6</span>Knowledge graph</h2>
  <p class="lead">All five stages as one graph. Ask it the competency questions in SPARQL, or look at it.</p>
  ${nextLine(6)}
  <div class="subtabs"><button class="${tab === 'query' ? 'on' : ''}" data-act="kgTab" data-arg="query">Query</button><button class="${tab === 'graph' ? 'on' : ''}" data-act="kgTab" data-arg="graph">Graph</button></div>
  ${tab === 'query' ? query : graph}`
}

function graphQuads() {
  const q = buildQuads(st, 'all')
  return st.ui.gInf ? reason(q).closure.filter((x) => !x.subject.value.startsWith('_:')) : q
}

function afterKg() {
  if (st.ui.view !== 'kg' || st.ui.kgTab !== 'graph') { stopGraph(); return }
  const svg = $('#gSvg'); if (!svg) return
  svg.style.height = Math.max(420, Math.min(900, window.innerHeight - 260)) + 'px'
  const r = drawGraph(svg, $('#gInfo'), graphQuads(), {
    bases: bases(st), compact: (i) => compact(st, i), focus: graphFocus,
    layers: { cbox: st.ui.gC !== false, tbox: st.ui.gT !== false, abox: st.ui.gA !== false }, edgeLabels: !!st.ui.gLabels,
  })
  graphFit = r.fit
  $('#gStats').textContent = `${r.nodes} nodes · ${r.edges} edges`
}

/* ------------------------------------------------------------ RDF */
function viewRdf() {
  const layer = st.ui.rdfLayer || 'all'
  const quads = buildQuads(st, layer)
  const about = { cbox: 'Concept schemes, concepts, labels, definitions, notes, hierarchy, mappings and collections, plus the ontology record.', tbox: 'Classes and properties with their axioms, and the SHACL shapes.', abox: 'The test individuals and their values.', all: 'All three layers in one graph: what stage 6 queries and draws.' }[layer]
  return `<h2><span class="tag" style="background:var(--ink-2)">RDF</span>See the RDF</h2>
  <p class="lead">What the project produces, as Turtle. It updates as you work.</p>
  <div class="panel"><div class="toolbar">
    <select data-bind="ui.rdfLayer" data-rerender style="width:auto">${[['cbox', 'CBox: vocabulary, taxonomy, thesaurus'], ['tbox', 'TBox: classes, properties, shapes'], ['abox', 'ABox: individuals'], ['all', 'Everything']].map(([v, l]) => opt(v, l, layer)).join('')}</select>
    <button class="sm" data-act="copyTtl">Copy</button><button class="sm" data-act="export" data-arg="ttl">Export .ttl</button><button class="sm" data-act="export" data-arg="nt">.nt</button><button class="sm" data-act="export" data-arg="jsonld">.jsonld</button><button class="sm" data-act="exportCsv">Vocabulary .csv</button></div>
    <p class="muted"><b>${quads.length} triples.</b> ${about}</p>
    <pre class="code" id="ttl">${esc(toTurtle(st, quads))}</pre></div>`
}

function download(name, text, type = 'text/plain') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
const fileBase = () => upperId(st.title).toLowerCase().slice(0, 40) || 'project'

/* ------------------------------------------------------------ render */
const VIEWS = { home: viewHome, vocab: viewVocab, profile: viewProfile, taxonomy: viewTaxonomy, thesaurus: viewThesaurus, ontology: viewOntology, kg: viewKg, rdf: viewRdf }
function render() {
  renderNav()
  const y = window.scrollY
  $('#main').innerHTML = (VIEWS[st.ui.view] || viewHome)()
  window.scrollTo(0, y)
  afterKg()
}

/* ------------------------------------------------------------ actions */
const A = {
  go(v) { st.ui.view = v; window.scrollTo(0, 0) },
  ontoTab(t) { st.ui.ontoTab = t },
  kgTab(t) { st.ui.kgTab = t },
  pick(arg) {
    const [kind, ...rest] = arg.split(':'); const id = rest.join(':')
    if (kind === 'scheme') { sel().scheme = id; sel().pane = 'scheme' }
    else if (kind === 'concept') { sel().concept = id; sel().scheme = T()[id]?.scheme; sel().pane = 'concept' }
    else sel()[kind] = id
  },
  runStage(n) { st.ui['check' + n] = true },

  addSource() { const name = val('srcName'); if (!name) return false; st.vocab.sources.push({ name, kind: val('srcKind') }) },
  rmSource(i) { st.vocab.sources.splice(+i, 1) },
  addTerm() {
    const label = val('termNew'); if (!label) return false
    const id = upperId(label); if (!id) return false
    if (T()[id]) { toast('A term with that identifier exists.'); sel().term = id; return }
    T()[id] = newTerm(label); sel().term = id
  },
  delTerm(k) {
    if (!confirm(`Delete "${termLabel(k)}" from every stage?`)) return false
    delete T()[k]
    for (const t of Object.values(T())) { if (t.broader === k) { t.broader = ''; t.isa = false } t.related = t.related.filter((r) => r !== k); if (t.replacedBy === k) t.replacedBy = '' }
    for (const c of Object.values(st.collections)) c.members = c.members.filter((m) => m !== k)
    for (const c of Object.values(O().classes)) if (c.fromConcept === k) c.fromConcept = ''
    for (const d of Object.values(O().individuals)) d.vals = d.vals.filter((v) => !(v.k === 'concept' && v.v === k))
    sel().term = ''
  },

  addElement() { const n = val('elAdd'); if (!n) return false; st.profile.elements[n] = { obligation: 'optional', max: dcKind(n) === 'concept' ? 'many' : '1', encoding: { date: 'iso8601', concept: 'vocab', iri: 'iri' }[dcKind(n)] || 'text', schemes: [], guideline: '', example: '' } },
  rmElement(n) { delete st.profile.elements[n] },
  toggleElScheme(arg) { const [n, s] = arg.split(':'); const e = st.profile.elements[n]; e.schemes = e.schemes.includes(s) ? e.schemes.filter((x) => x !== s) : [...e.schemes, s] },
  addSystem() { const s = val('sysNew'); if (!s || st.profile.systems.includes(s)) return false; st.profile.systems.push(s) },
  rmSystem(i) { st.profile.systems.splice(+i, 1) },

  addScheme() {
    const title = val('schemeNew'); const id = upperId(title); if (!id) return false
    if (st.schemes[id]) { toast('That scheme exists.'); return false }
    st.schemes[id] = { title, description: '' }; sel().scheme = id; sel().pane = 'scheme'
  },
  delScheme(sid) {
    if (!confirm('Delete the scheme? Its concepts go back to the unplaced list.')) return false
    termsInScheme(st, sid).forEach((k) => Object.assign(T()[k], { scheme: '', broader: '', isa: false }))
    delete st.schemes[sid]; sel().pane = ''
  },
  place(k) {
    const sid = st.schemes[sel().scheme] ? sel().scheme : Object.keys(st.schemes)[0]
    if (!sid) { toast('Add a scheme first.'); return false }
    Object.assign(T()[k], { scheme: sid, broader: '', isa: false }); sel().concept = k; sel().pane = 'concept'
  },
  unplace(k) {
    Object.values(T()).forEach((t) => { if (t.broader === k) { t.broader = ''; t.isa = false } })
    Object.assign(T()[k], { scheme: '', broader: '', isa: false }); sel().concept = ''
  },
  addRelated(k) { const r = val('relAdd'); if (!r) return false; if (!T()[k].related.includes(r)) T()[k].related.push(r); if (!T()[r].related.includes(k)) T()[r].related.push(k) },
  rmRelated(arg) { const [k, r] = arg.split(':'); T()[k].related = T()[k].related.filter((x) => x !== r); if (T()[r]) T()[r].related = T()[r].related.filter((x) => x !== k) },
  addMatch(k) { const uri = val('matchUri'); if (!/^https?:\/\/\S+$/.test(uri)) { toast('A mapping needs the outside concept\'s http(s) IRI.'); return false } T()[k].matches.push({ rel: val('matchRel'), uri }) },
  rmMatch(arg) { const [k, i] = arg.split(':'); T()[k].matches.splice(+i, 1) },
  addCollection() { const label = val('colNew'); const id = upperId(label); if (!id || st.collections[id]) return false; st.collections[id] = { label, ordered: document.getElementById('colOrdered').checked, members: [] } },
  delCollection(id) { delete st.collections[id] },
  addMember(id) { const m = val('mem-' + id); if (!m) return false; st.collections[id].members.push(m) },
  rmMember(arg) { const [id, i] = arg.split(':'); st.collections[id].members.splice(+i, 1) },

  addCq() { const text = val('cqNew'); if (!text) return false; O().cqs.push({ id: 'cq' + uid(), text, sparql: '' }) },
  rmCq(i) { O().cqs.splice(+i, 1) },
  toggleReuse(v) { const r = O().reuse; O().reuse = r.includes(v) ? r.filter((x) => x !== v) : [...r, v] },
  toggleRecord(k) { const r = O().records; O().records = r.includes(k) ? r.filter((x) => x !== k) : [...r, k] },
  addClass() {
    const label = val('clsNew'); const id = upperId(label); if (!id) return false
    if (O().classes[id]) { toast('That class exists.'); return false }
    O().classes[id] = { label, comment: '', sub: [], disjoint: [], fromConcept: '', cq: '' }; sel().cls = id
  },
  promote() {
    const k = val('promote'); if (!k) return false
    O().classes[k] = { label: termLabel(k), comment: T()[k].definition, sub: [], disjoint: [], fromConcept: k, cq: '' }; sel().cls = k
    toast('Promoted: the class keeps skos:exactMatch back to its concept.')
  },
  delClass(k) {
    if (!confirm(`Delete the class ${k}?`)) return false
    delete O().classes[k]
    for (const c of Object.values(O().classes)) { c.sub = c.sub.filter((x) => x !== k); c.disjoint = c.disjoint.filter((x) => x !== k) }
    for (const p of Object.values(O().props)) { if (p.domain === k) p.domain = ''; if (p.range === k) p.range = '' }
    for (const s of Object.values(O().shapes)) { if (s.target === k) s.target = ''; if (s.cls === k) s.cls = '' }
    for (const d of Object.values(O().individuals)) d.types = d.types.filter((t) => t !== k)
    O().records = O().records.filter((x) => x !== k); sel().cls = ''
  },
  addSub(k) { const v = val('subAdd'); if (!v) return false; O().classes[k].sub.push(v) },
  rmSub(arg) { const i = arg.indexOf(':'); const k = arg.slice(0, i), v = arg.slice(i + 1); O().classes[k].sub = O().classes[k].sub.filter((x) => x !== v) },
  addDisjoint(k) { const v = val('disAdd'); if (!v) return false; O().classes[k].disjoint.push(v); if (!O().classes[v].disjoint.includes(k)) O().classes[v].disjoint.push(k) },
  rmDisjoint(arg) { const [k, v] = arg.split(':'); O().classes[k].disjoint = O().classes[k].disjoint.filter((x) => x !== v); if (O().classes[v]) O().classes[v].disjoint = O().classes[v].disjoint.filter((x) => x !== k) },
  addProp() {
    const label = val('propNew'); const id = lowerId(label); if (!id) return false
    if (O().props[id]) { toast('That property exists.'); return false }
    O().props[id] = { label, comment: '', domain: '', range: '', functional: false, transitive: false, inverse: '', sub: '', cq: '' }; sel().prop = id
  },
  delProp(k) {
    if (!confirm(`Delete the property ${k}?`)) return false
    delete O().props[k]
    for (const p of Object.values(O().props)) { if (p.inverse === k) p.inverse = ''; if (p.sub === k) p.sub = '' }
    for (const d of Object.values(O().individuals)) d.vals = d.vals.filter((v) => v.p !== k)
    for (const s of Object.values(O().shapes)) s.path = s.path.filter((x) => x !== k)
    sel().prop = ''
  },
  setInverse(pk, el) {
    const p = O().props[pk], old = p.inverse
    if (old && O().props[old]?.inverse === pk) O().props[old].inverse = ''
    p.inverse = el.value
    if (p.inverse) O().props[p.inverse].inverse = pk
  },
  addShape() {
    let id = upperId(val('shapeNew')); if (!id) return false
    if (!/Shape$/.test(id)) id += 'Shape'
    if (O().shapes[id]) { toast('That shape exists.'); return false }
    O().shapes[id] = { target: '', path: [], cls: '', datatype: '', hasValue: '', min: '1', max: '', message: '' }; sel().shape = id
  },
  delShape(k) { delete O().shapes[k]; sel().shape = '' },
  setPath(arg, el) { const [k, i] = arg.split(':'); const p = O().shapes[k].path; p[+i] = el.value; O().shapes[k].path = p.slice(0, 2).filter((x, j) => x && (j === 0 || p[0])) },

  addInd() {
    const cls = val('indCls'); if (!cls) { toast('Add a class first.'); return false }
    const base = cls.replace(/^.*:/, '').toLowerCase(); let n = 1
    while (O().individuals[`${base}-${n}`]) n++
    O().individuals[`${base}-${n}`] = { types: [cls], label: '', comment: '', vals: [] }; sel().ind = `${base}-${n}`
  },
  delInd(k) {
    delete O().individuals[k]
    for (const d of Object.values(O().individuals)) d.vals = d.vals.filter((v) => !(v.k === 'ind' && v.v === k))
    sel().ind = ''
  },
  addType(k) { const t = val('typeAdd'); if (!t) return false; O().individuals[k].types.push(t) },
  rmType(arg) { const i = arg.indexOf(':'); const k = arg.slice(0, i), t = arg.slice(i + 1); O().individuals[k].types = O().individuals[k].types.filter((x) => x !== t) },
  pickNewProp(_, el) { sel().newProp = el.value },
  addVal(k) {
    const d = O().individuals[k], p = sel().newProp && propsFor(d).includes(sel().newProp) ? sel().newProp : propsFor(d)[0]
    const info = propInfo(st, p); if (!info) return false
    const indPick = val('valNewInd'), v = val('valNew')
    if (indPick) { d.vals.push({ p, k: 'ind', v: indPick }); return }
    if (!v) return false
    const kind = rangeKind(info.range)
    d.vals.push({ p, k: kind === 'ind' ? 'ind' : kind === 'concept' ? 'concept' : kind === 'iri' ? 'iri' : 'lit', v })
  },
  rmVal(arg) { const i = arg.lastIndexOf(':'); O().individuals[arg.slice(0, i)].vals.splice(+arg.slice(i + 1), 1) },
  runCheck() { runCheck(); return false },

  loadPreset(_, el) {
    const ps = presets(); const i = el.value
    st.ui.presetIdx = i; if (ps[i]) st.ui.query = ps[i].q; lastQuery = null
  },
  async runQuery() {
    const q = $('#qText').value; st.ui.query = q
    const t0 = performance.now()
    try {
      let quads = buildQuads(st, 'all')
      if (st.ui.withInferences !== false) quads = reason(quads).closure
      const res = await sparql(quads, q)
      lastQuery = { ...res, ms: (performance.now() - t0).toFixed(1), triples: quads.length, inferred: st.ui.withInferences !== false }
    } catch (e) { lastQuery = { error: String(e.message || e) } }
    save(); render()
    return false
  },
  saveCq(id) {
    const q = O().cqs.find((x) => x.id === id); if (!q) return false
    q.sparql = $('#qText').value; toast('Saved. The Check runs it as the test for this question.')
  },
  drawResult() {
    if (!lastQuery?.rows) return false
    graphFocus = new Set(lastQuery.rows.flatMap((r) => Object.values(r)).filter((t) => t.termType === 'NamedNode').map((t) => t.value))
    if (!graphFocus.size) { graphFocus = null; return false }
    st.ui.kgTab = 'graph'
  },
  clearFocus() { graphFocus = null },
  fitGraph() { graphFit?.(); return false },

  copyTtl() { navigator.clipboard?.writeText($('#ttl').textContent).then(() => toast('Copied.'), () => toast('Copy failed; select the text instead.')); return false },
  export(fmt) {
    const quads = buildQuads(st, st.ui.rdfLayer || 'all')
    const text = fmt === 'ttl' ? toTurtle(st, quads) : fmt === 'nt' ? toNTriples(quads) : toJsonLd(st, quads)
    download(`${fileBase()}-${st.ui.rdfLayer || 'all'}.${fmt}`, text); return false
  },
  exportCsv() {
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
    const rows = [['id', 'scheme', 'preferred label', 'broader', 'definition', 'alternative labels', 'hidden labels', 'related', 'notation', 'status', 'source']]
    for (const [k, t] of Object.entries(T())) rows.push([k, st.schemes[t.scheme]?.title || '', t.label, t.broader ? termLabel(t.broader) : '', t.definition, t.alt.join('; '), t.hidden.join('; '), t.related.map(termLabel).join('; '), t.notation, t.status, t.source])
    download(`${fileBase()}-vocabulary.csv`, rows.map((r) => r.map(q).join(',')).join('\n'), 'text/csv'); return false
  },

  newProject() { const p = blankProject(prompt('Name for the new project', 'Untitled project') || 'Untitled project'); db.projects[p.id] = p; switchTo(p.id); return false },
  loadExample() { const p = researchExample(); db.projects[p.id] = p; switchTo(p.id); toast('Loaded a fresh copy of the example.'); return false },
  renameProject() { const t = prompt('Project title', st.title); if (!t) return false; st.title = t },
  exportProject() { download(`${fileBase()}.project.json`, JSON.stringify(st, null, 2), 'application/json'); return false },
  deleteProject() {
    if (!confirm(`Delete "${st.title}" from this browser? Export it first if you want to keep it.`)) return false
    delete db.projects[db.current]
    if (!Object.keys(db.projects).length) { const p = researchExample(); db.projects[p.id] = p }
    switchTo(Object.keys(db.projects)[0]); return false
  },
}

/* ------------------------------------------------------------ events */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]')
  if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox')) return
  const fn = A[el.dataset.act]; if (!fn) return
  if (el.closest('.menu')) el.closest('.menu').open = false
  const r = await fn(el.dataset.arg ?? '', el)
  if (r === false) return
  save(); render()
})
document.addEventListener('change', (e) => {
  const el = e.target
  if (el.dataset.actChange) { A[el.dataset.actChange](el.dataset.arg ?? '', el); save(); render(); return }
  if (el.dataset.bind && (el.type === 'checkbox' || el.tagName === 'SELECT')) { bind(el); return }
  if (el.dataset.bind && el.dataset.rerender !== undefined) render()
  if (el.dataset.list) { setPath(st, el.dataset.list, el.value.split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean)); save(); render() }
})
document.addEventListener('input', (e) => {
  const el = e.target
  if (el.dataset.bind && el.type !== 'checkbox' && el.tagName !== 'SELECT') bind(el, false)
  if (el.dataset.xwalk) { (st.profile.crosswalk[el.dataset.xwalk] ||= {})[el.dataset.sys] = el.value; save() }
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset?.enter) { e.preventDefault(); A[e.target.dataset.enter](); save(); render() }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.id === 'qText') A.runQuery()
})
function bind(el, allowRender = true) {
  const path = el.dataset.bind
  let v = el.type === 'checkbox' ? el.checked : el.value
  if (/^onto\.prefix\./.test(path)) v = v.replace(/[^A-Za-z0-9_-]/g, '').toLowerCase()
  if (/^onto\.base\./.test(path)) v = v.trim()
  setPath(st, path, v)
  if (el.dataset.resetIsa) T()[el.dataset.resetIsa].isa = false
  if (el.dataset.resetBroader) Object.assign(T()[el.dataset.resetBroader], { broader: '', isa: false })
  if (path.startsWith('onto.') || path.startsWith('vocab.') || path.startsWith('profile.') || path.startsWith('schemes')) lastCheck = null
  save()
  if (el.dataset.live) { const pos = el.selectionStart; render(); const again = document.querySelector(`[data-bind="${path}"]`); if (again) { again.focus(); again.setSelectionRange(pos, pos) } return }
  if (allowRender && (el.dataset.rerender !== undefined || el.type === 'checkbox' || el.tagName === 'SELECT')) render()
  else if (path === 'title') renderNav()
}
$('#projectPick').addEventListener('change', (e) => switchTo(e.target.value))
$('#importProject').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return
  try {
    const p = JSON.parse(await f.text())
    if (!p.vocab || !p.onto) throw new Error('not a project file')
    p.id = uid(); db.projects[p.id] = p; switchTo(p.id); toast('Imported ' + p.title)
  } catch (err) { toast('Could not import: ' + err.message) }
  e.target.value = ''
})
document.addEventListener('click', (e) => { const m = $('#projectMenu'); if (m.open && !m.contains(e.target)) m.open = false })
let resizeT
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(afterKg, 250) })

render()
oxigraphReady().catch((e) => toast('SPARQL engine failed to load: ' + e.message))
