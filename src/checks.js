// Quality checks for stages 1–4 and the project-wide progress summary. Each rule returns findings: {sev, msg, where}.

import { DC_ELEMENTS, dcKind } from './vocab.js'
import { placedTerms, termsInScheme } from './rdf.js'

const err = (msg, where) => ({ sev: 'error', msg, where })
const warn = (msg, where) => ({ sev: 'warning', msg, where })

const terms = (st) => st.vocab.terms
const approved = (st) => Object.keys(terms(st)).filter((k) => terms(st)[k].status === 'approved')
const lbl = (st, k) => terms(st)[k]?.label || k

function circular(label, def) {
  const words = label.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
  const rest = def.toLowerCase().replace(label.toLowerCase(), '')
  return words.length > 0 && words.every((w) => rest.includes(w)) && rest.split(/\s+/).length < 12
}

export function ancestors(st, k) {
  const out = []
  let cur = terms(st)[k]?.broader
  while (cur && !out.includes(cur) && out.length < 50) { out.push(cur); cur = terms(st)[cur]?.broader }
  return out
}
export function descendants(st, k) {
  const out = new Set()
  const walk = (x) => Object.keys(terms(st)).forEach((c) => { if (terms(st)[c].broader === x && !out.has(c)) { out.add(c); walk(c) } })
  walk(k)
  return out
}

export const RULES = {
  1: [
    ['The vocabulary states its purpose and what it leaves out.', (st) => [
      ...(!st.vocab.purpose.trim() ? [err('No purpose: say which decisions the vocabulary supports.')] : []),
      ...(!st.vocab.outScope.trim() ? [warn('Nothing is named as out of scope.')] : []),
    ]],
    ['Every term records where it came from.', (st) => [
      ...(!st.vocab.sources.length ? [warn('No sources listed.')] : []),
      ...approved(st).filter((k) => !terms(st)[k].source).map((k) => warn('No source recorded.', lbl(st, k))),
    ]],
    ['Preferred labels are unique and present.', (st) => {
      const seen = {}, out = []
      for (const [k, t] of Object.entries(terms(st))) {
        const key = t.label.trim().toLowerCase()
        if (!key) out.push(err('No preferred label.', k))
        else if (seen[key]) out.push(err(`"${t.label}" is the preferred label of two terms.`, k))
        seen[key] = true
      }
      return out
    }],
    ['Every approved term has a definition, and none is circular.', (st) => approved(st).flatMap((k) => {
      const t = terms(st)[k]
      if (!t.definition.trim()) return [err('No definition.', t.label)]
      const out = []
      if (circular(t.label, t.definition)) out.push(err('The definition repeats the term instead of explaining it.', t.label))
      if (!/\b(is|are) (a|an|the)\b/i.test(t.definition)) out.push(warn('Not in the form "X is a [broader kind] that [distinguishing trait]".', t.label))
      return out
    })],
    ['Alternative labels do not collide with another term\'s preferred label.', (st) => {
      const prefs = new Map(Object.entries(terms(st)).map(([k, t]) => [t.label.toLowerCase(), k]))
      return Object.entries(terms(st)).flatMap(([k, t]) => t.alt.filter((a) => prefs.has(a.toLowerCase()) && prefs.get(a.toLowerCase()) !== k).map((a) => err(`Alternative label "${a}" is another term's preferred label.`, t.label)))
    }],
    ['Acronyms are alternative labels, not preferred labels.', (st) => Object.values(terms(st)).filter((t) => /^[A-Z]{2,6}$/.test(t.label.trim())).map((t) => warn('Preferred label looks like an acronym; spell it out and keep the acronym as an alternative.', t.label))],
    ['Deprecated terms name their replacement.', (st) => Object.values(terms(st)).filter((t) => t.status === 'deprecated' && !t.replacedBy).map((t) => warn('Deprecated with no replacement.', t.label))],
  ],
  2: [
    ['The profile has a title and says what records it governs.', (st) => [
      ...(!st.profile.title.trim() ? [warn('No title.')] : []),
      ...(!st.profile.appliesTo.trim() ? [warn('Does not say what the records describe.')] : []),
    ]],
    ['Records carry a title and an identifier.', (st) => ['title', 'identifier'].filter((n) => !st.profile.elements[n]).map((n) => warn(`dct:${n} is not in the profile.`))],
    ['Every element has guidance and an example.', (st) => Object.entries(st.profile.elements).flatMap(([n, e]) => [
      ...(!e.guideline.trim() ? [warn('No input guideline.', 'dct:' + n)] : []),
      ...(!e.example.trim() ? [warn('No example.', 'dct:' + n)] : []),
    ])],
    ['Dates are ISO 8601, never free text.', (st) => Object.entries(st.profile.elements).filter(([n, e]) => dcKind(n) === 'date' && e.encoding !== 'iso8601').map(([n]) => err('A date element is not encoded as ISO 8601.', 'dct:' + n))],
    ['Controlled-value elements name the scheme they draw from.', (st) => Object.entries(st.profile.elements).filter(([n, e]) => e.encoding === 'vocab' && !(e.schemes || []).some((s) => st.schemes[s])).map(([n]) => warn('Takes controlled values but names no scheme.', 'dct:' + n))],
    ['Each connected system has a field for every element.', (st) => {
      if (!st.profile.systems.length) return [warn('No systems in the crosswalk.')]
      return st.profile.systems.flatMap((sys) => {
        const miss = Object.keys(st.profile.elements).filter((n) => !(st.profile.crosswalk[n] || {})[sys])
        return miss.length ? [warn(`No field mapped for ${miss.map((n) => 'dct:' + n).join(', ')}.`, sys)] : []
      })
    }],
  ],
  3: [
    ['Use cases come before the hierarchy: the scheme says what it covers.', (st) => Object.entries(st.schemes).filter(([, s]) => !s.description.trim()).map(([, s]) => warn('Scheme has no description of its coverage.', s.title))],
    ['Every approved term is placed in a scheme.', (st) => approved(st).filter((k) => !st.schemes[terms(st)[k].scheme]).map((k) => warn('Approved but not placed.', lbl(st, k)))],
    ['Every parent passes the is-a test.', (st) => placedTerms(st).filter((k) => terms(st)[k].broader && !terms(st)[k].isa).map((k) => err(`Not confirmed: is "${lbl(st, k)}" a kind of "${lbl(st, terms(st)[k].broader)}"?`, lbl(st, k)))],
    ['A parent sits in the same scheme as its child.', (st) => placedTerms(st).filter((k) => { const b = terms(st)[k].broader; return b && terms(st)[b]?.scheme !== terms(st)[k].scheme }).map((k) => err('Its broader concept is in another scheme.', lbl(st, k)))],
    ['No cycles in the hierarchy.', (st) => placedTerms(st).filter((k) => ancestors(st, k).includes(k)).map((k) => err('The broader chain loops back to itself.', lbl(st, k)))],
    ['Each scheme has top concepts, and depth stays at four levels or fewer.', (st) => [
      ...Object.entries(st.schemes).filter(([sid]) => !termsInScheme(st, sid).some((k) => !terms(st)[k].broader)).map(([, s]) => err('No top concept.', s.title)),
      ...placedTerms(st).filter((k) => ancestors(st, k).length >= 4).map((k) => warn(`Level ${ancestors(st, k).length + 1}; consider flattening.`, lbl(st, k))),
    ]],
  ],
  4: [
    ['Related links are symmetric and never repeat the hierarchy.', (st) => placedTerms(st).flatMap((k) => {
      const t = terms(st)[k], hier = new Set([...ancestors(st, k), ...descendants(st, k)])
      return t.related.flatMap((r) => [
        ...(hier.has(r) ? [err(`Related to "${lbl(st, r)}", which is already in its hierarchy.`, t.label)] : []),
        ...(!terms(st)[r]?.related.includes(k) ? [warn(`Related to "${lbl(st, r)}" but not the other way round.`, t.label)] : []),
      ])
    })],
    ['Mappings point outside this vocabulary, at real IRIs.', (st) => placedTerms(st).flatMap((k) => terms(st)[k].matches.filter((m) => !/^https?:\/\//.test(m.uri) || (st.onto.base.concept && m.uri.startsWith(st.onto.base.concept))).map(() => err('A mapping is not an external http(s) IRI.', lbl(st, k))))],
    ['exactMatch is used sparingly.', (st) => placedTerms(st).filter((k) => terms(st)[k].matches.filter((m) => m.rel === 'exactMatch').length > 1).map((k) => warn('More than one exactMatch; closeMatch is usually more honest.', lbl(st, k)))],
    ['Concepts with several relations explain their boundary.', (st) => placedTerms(st).filter((k) => { const t = terms(st)[k]; return t.related.length + t.matches.length >= 3 && !t.scopeNote }).map((k) => warn('Several relations and no scope note.', lbl(st, k)))],
    ['Collections have members, and only placed concepts.', (st) => Object.values(st.collections).flatMap((c) => [
      ...(!c.members.length ? [warn('No members.', c.label)] : []),
      ...c.members.filter((m) => !st.schemes[terms(st)[m]?.scheme]).map((m) => err(`Lists "${m}", which is not in a scheme.`, c.label)),
    ])],
  ],
}

export function runStage(st, n) {
  return RULES[n].map(([text, fn]) => ({ text, findings: fn(st) }))
}

// what each stage still needs before the next one has something to build on
export function needs(st) {
  const O = st.onto
  const n = {}
  n[1] = []
  if (!st.vocab.purpose.trim()) n[1].push('a purpose')
  if (!approved(st).some((k) => terms(st)[k].definition.trim())) n[1].push('an approved term with a definition')
  n[2] = Object.keys(st.profile.elements).length ? [] : ['at least one metadata element']
  n[3] = []
  if (!Object.keys(st.schemes).length) n[3].push('a concept scheme')
  if (!placedTerms(st).length) n[3].push('a term placed in a scheme')
  const noIsa = placedTerms(st).filter((k) => terms(st)[k].broader && !terms(st)[k].isa)
  if (noIsa.length) n[3].push('the is-a test confirmed for ' + noIsa.map((k) => lbl(st, k)).join(', '))
  n[4] = placedTerms(st).filter((k) => !terms(st)[k].definition.trim()).map((k) => 'a definition for ' + lbl(st, k))
  n[5] = []
  if (!O.cqs.length) n[5].push('a competency question')
  for (const box of ['concept', 'schema', 'data']) if (!/^https?:\/\/\S+[#/]$/.test(O.base[box]) || !O.prefix[box]) n[5].push(`a ${box} namespace ending in # or /, with a prefix`)
  if (!Object.keys(O.classes).length) n[5].push('a class')
  const noComment = Object.keys(O.classes).filter((k) => !O.classes[k].comment.trim())
  if (noComment.length) n[5].push('a comment on ' + noComment.join(', '))
  if (!Object.keys(O.individuals).length) n[5].push('a test individual')
  n[6] = O.cqs.filter((q) => !q.sparql.trim()).map((q) => 'a query for "' + q.text.slice(0, 50) + '"')
  return n
}

export { DC_ELEMENTS }
