// Namespaces, Dublin Core elements, and the small registry of reusable standard vocabularies.

export const NS = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dct: 'http://purl.org/dc/terms/',
  sh: 'http://www.w3.org/ns/shacl#',
}

export const RDF_TYPE = NS.rdf + 'type'

export const XSD_TYPES = ['string', 'integer', 'decimal', 'boolean', 'date', 'dateTime', 'gYear', 'anyURI']

// [local name, label, kind]; kind decides the default encoding and range: literal | date | concept | iri
export const DC_ELEMENTS = [
  ['title', 'Title', 'literal'],
  ['description', 'Description', 'literal'],
  ['identifier', 'Identifier', 'literal'],
  ['creator', 'Creator', 'iri'],
  ['contributor', 'Contributor', 'iri'],
  ['publisher', 'Publisher', 'iri'],
  ['created', 'Created', 'date'],
  ['modified', 'Modified', 'date'],
  ['issued', 'Issued', 'date'],
  ['subject', 'Subject', 'concept'],
  ['type', 'Type', 'concept'],
  ['format', 'Format', 'literal'],
  ['language', 'Language', 'literal'],
  ['license', 'License', 'iri'],
  ['rights', 'Rights', 'literal'],
  ['source', 'Source', 'iri'],
  ['relation', 'Relation', 'iri'],
  ['isPartOf', 'Is part of', 'iri'],
  ['conformsTo', 'Conforms to', 'iri'],
]

export const ENCODINGS = {
  text: 'free text',
  iso8601: 'ISO 8601 date',
  iri: 'IRI / reference',
  vocab: 'controlled vocabulary',
  integer: 'integer',
  bcp47: 'language tag (BCP 47)',
}

export function dcKind(name) {
  return (DC_ELEMENTS.find((e) => e[0] === name) || [])[2] || 'literal'
}

// Standard vocabularies a TBox can build on. Classes may declare their own superclass inside the vocabulary;
// properties give [domain, range] where range is a class CURIE, 'skos:Concept' or an xsd type.
export const STANDARDS = {
  prov: {
    label: 'PROV-O',
    ns: 'http://www.w3.org/ns/prov#',
    imports: 'http://www.w3.org/ns/prov-o',
    about: 'Provenance: entities, the activities that produced them, and the agents responsible.',
    classes: { Entity: null, Activity: null, Agent: null, Plan: 'prov:Entity', SoftwareAgent: 'prov:Agent', Person: 'prov:Agent', Organization: 'prov:Agent' },
    props: {
      wasGeneratedBy: ['prov:Entity', 'prov:Activity'],
      wasAttributedTo: ['prov:Entity', 'prov:Agent'],
      wasDerivedFrom: ['prov:Entity', 'prov:Entity'],
      used: ['prov:Activity', 'prov:Entity'],
      wasAssociatedWith: ['prov:Activity', 'prov:Agent'],
      startedAtTime: ['prov:Activity', 'xsd:dateTime'],
    },
  },
  foaf: {
    label: 'FOAF',
    ns: 'http://xmlns.com/foaf/0.1/',
    imports: 'http://xmlns.com/foaf/0.1/',
    about: 'People, groups and organizations, with names and contact points.',
    classes: { Agent: null, Person: 'foaf:Agent', Organization: 'foaf:Agent', Group: 'foaf:Agent' },
    props: { name: ['', 'xsd:string'], mbox: ['foaf:Agent', 'xsd:anyURI'], homepage: ['', 'xsd:anyURI'], member: ['foaf:Group', 'foaf:Agent'] },
  },
  schema: {
    label: 'Schema.org',
    ns: 'https://schema.org/',
    imports: null,
    about: 'Web-scale descriptions of creative works, organizations, software and events.',
    classes: { CreativeWork: null, ScholarlyArticle: 'schema:CreativeWork', Organization: null, Person: null, SoftwareApplication: 'schema:CreativeWork', Event: null, Place: null },
    props: { name: ['', 'xsd:string'], url: ['', 'xsd:anyURI'], datePublished: ['schema:CreativeWork', 'xsd:date'], sameAs: ['', 'xsd:anyURI'], memberOf: ['', 'schema:Organization'] },
  },
  dcat: {
    label: 'DCAT',
    ns: 'http://www.w3.org/ns/dcat#',
    imports: 'http://www.w3.org/ns/dcat',
    about: 'Datasets, their distributions, and catalogs.',
    classes: { Dataset: null, Distribution: null, Catalog: null },
    props: { distribution: ['dcat:Dataset', 'dcat:Distribution'], keyword: ['dcat:Dataset', 'xsd:string'], landingPage: ['dcat:Dataset', 'xsd:anyURI'], theme: ['dcat:Dataset', 'skos:Concept'] },
  },
}

export const MATCH_RELS = ['exactMatch', 'closeMatch', 'broadMatch', 'narrowMatch', 'relatedMatch']
