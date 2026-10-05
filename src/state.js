// Project state: one object per project, persisted to localStorage.

import { researchExample } from './example.js'

const KEY = 'ontology-workbench.v1'

export function blankProject(title = 'Untitled project') {
  return {
    id: uid(),
    title,
    about: { domain: '', purpose: '', steward: '' },
    vocab: { purpose: '', inScope: '', outScope: '', sources: [], terms: {} },
    profile: { title: '', appliesTo: '', elements: {}, systems: [], crosswalk: {} },
    schemes: {},
    collections: {},
    onto: {
      title: '', version: '0.1.0', description: '', creator: '', license: '',
      base: { concept: '', schema: '', data: '' },
      prefix: { concept: '', schema: '', data: '' },
      reuse: [],
      cqs: [],
      classes: {},
      props: {},
      shapes: {},
      records: [],
      individuals: {},
    },
    ui: { view: 'home', ontoTab: 'cbox', kgTab: 'query', rdfLayer: 'all', sel: {} },
  }
}

export function newTerm(label) {
  return {
    label, alt: [], hidden: [], definition: '', source: '', owner: '', status: 'candidate', replacedBy: '',
    scheme: '', broader: '', isa: false, related: [], matches: [], scopeNote: '', notation: '', example: '',
  }
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function slug(s) {
  return String(s || '').trim().replace(/[^A-Za-z0-9]+/g, ' ').trim()
    .split(' ').map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('')
}

export const upperId = (s) => { const v = slug(s); return v ? v[0].toUpperCase() + v.slice(1) : '' }
export const lowerId = (s) => { const v = slug(s); return v ? v[0].toLowerCase() + v.slice(1) : '' }

export function loadDb() {
  try {
    const db = JSON.parse(localStorage.getItem(KEY))
    if (db && db.projects && db.projects[db.current]) return db
  } catch (e) { /* storage unavailable or corrupt: start fresh */ }
  const p = researchExample()
  return { current: p.id, projects: { [p.id]: p } }
}

export function saveDb(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); return true } catch (e) { return false }
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

export function setPath(obj, path, value) {
  const keys = path.split('.')
  let o = obj
  for (const k of keys.slice(0, -1)) { if (o[k] == null) o[k] = {}; o = o[k] }
  o[keys[keys.length - 1]] = value
}
