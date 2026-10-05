// The built-in example: a research reading list on retrieval-augmented generation and knowledge graphs.
// Papers, people, labs and datasets are fictional; the example.org namespaces make that explicit.

import { blankProject, newTerm } from './state.js'

const PRE = `PREFIX rkg: <https://example.org/rkg/schema#>
PREFIX rkgc: <https://example.org/rkg/concept/>
PREFIX rd: <https://example.org/rkg/data/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dct: <http://purl.org/dc/terms/>

`

const dbpedia = (name) => ({ rel: 'closeMatch', uri: 'http://dbpedia.org/resource/' + name })

export function researchExample() {
  const p = blankProject('Example: GraphRAG reading list')
  p.example = 'research'
  p.about = {
    domain: 'Research papers on retrieval-augmented generation and knowledge graphs, the methods they propose, the datasets they evaluate on, and the people and labs behind them.',
    purpose: 'Answer the questions a reading group asks: what to read on a topic, how methods build on each other, which datasets matter, and who is doing the work.',
    steward: 'Reading group organizer',
  }

  const T = (label, def, scheme, extra = {}) => Object.assign(newTerm(label), { definition: def, scheme, status: 'approved', source: 'Reading group glossary', owner: 'Reading group organizer' }, extra)
  p.vocab = {
    purpose: 'Tag papers consistently so the reading list can be filtered by topic, kind of paper and publication status.',
    inScope: 'Research topics in retrieval and knowledge graphs; kinds of paper; publication status.',
    outScope: 'Individual model names, benchmark scores, and venue rankings.',
    sources: [
      { name: 'Reading group glossary', kind: 'internal document' },
      { name: 'Paper abstracts', kind: 'content' },
      { name: 'DBpedia', kind: 'authority file' },
    ],
    terms: {
      InformationRetrieval: T('Information retrieval', 'Information retrieval is a field of computing that finds the documents or passages relevant to a need expressed as a query.', 'Topic', { matches: [dbpedia('Information_retrieval')], related: ['RetrievalAugmentedGeneration'] }),
      VectorRetrieval: T('Vector retrieval', 'Vector retrieval is an information retrieval approach that ranks passages by the similarity of their embeddings to the query embedding.', 'Topic', { broader: 'InformationRetrieval', isa: true, alt: ['Dense retrieval', 'Vector search'] }),
      KeywordRetrieval: T('Keyword retrieval', 'Keyword retrieval is an information retrieval approach that ranks documents by the terms they share with the query.', 'Topic', { broader: 'InformationRetrieval', isa: true, alt: ['Lexical retrieval', 'BM25 search'] }),
      RetrievalAugmentedGeneration: T('Retrieval-augmented generation', 'Retrieval-augmented generation is a text-generation technique that grounds a language model\'s answer in material retrieved at query time.', 'Topic', { alt: ['RAG'], matches: [dbpedia('Retrieval-augmented_generation')], related: ['InformationRetrieval'], scopeNote: 'Use for systems that retrieve and then generate. Pure search systems belong under Information retrieval.' }),
      GraphRag: T('Graph-based RAG', 'Graph-based RAG is a form of retrieval-augmented generation that retrieves from a graph of entities and relations instead of, or as well as, from passages.', 'Topic', { broader: 'RetrievalAugmentedGeneration', isa: true, alt: ['GraphRAG'], hidden: ['Graph RAG', 'Grpah RAG'], related: ['KnowledgeGraph', 'CommunityDetection'] }),
      KnowledgeGraph: T('Knowledge graph', 'Knowledge graph is a data model that represents entities and their typed relations as a graph, often governed by an ontology.', 'Topic', { matches: [dbpedia('Knowledge_graph')], related: ['GraphRag', 'OntologyEngineering', 'EntityExtraction'], scopeNote: 'Papers about building, governing or querying a graph of typed entities. A paper that only uses a graph as a retrieval index goes under Graph-based RAG.' }),
      OntologyEngineering: T('Ontology engineering', 'Ontology engineering is a discipline that designs the classes, properties and constraints a knowledge graph is governed by.', 'Topic', { matches: [{ rel: 'broadMatch', uri: 'http://dbpedia.org/resource/Ontology_(information_science)' }], related: ['KnowledgeGraph'] }),
      InformationExtraction: T('Information extraction', 'Information extraction is a field of language processing that turns unstructured text into structured records.', 'Topic', { matches: [dbpedia('Information_extraction')] }),
      EntityExtraction: T('Entity extraction', 'Entity extraction is an information extraction task that finds the names of people, places, organizations and other things in text.', 'Topic', { broader: 'InformationExtraction', isa: true, alt: ['Named-entity recognition', 'NER'], related: ['KnowledgeGraph'], matches: [dbpedia('Named-entity_recognition')] }),
      RelationExtraction: T('Relation extraction', 'Relation extraction is an information extraction task that finds the typed relations stated between entities in text.', 'Topic', { broader: 'InformationExtraction', isa: true }),
      CommunityDetection: T('Community detection', 'Community detection is a graph analysis technique that partitions a graph into densely connected groups of nodes.', 'Topic', { related: ['GraphRag'], matches: [dbpedia('Community_structure')] }),

      ResearchArticle: T('Research article', 'Research article is a kind of paper that reports original work and its evaluation.', 'PaperType', { notation: 'PT-1' }),
      BenchmarkStudy: T('Benchmark study', 'Benchmark study is a research article that compares existing methods on shared datasets rather than proposing a new one.', 'PaperType', { broader: 'ResearchArticle', isa: true, notation: 'PT-1.1' }),
      Survey: T('Survey', 'Survey is a kind of paper that organizes and compares the published work on a topic.', 'PaperType', { alt: ['Review article'], notation: 'PT-2' }),
      PositionPaper: T('Position paper', 'Position paper is a kind of paper that argues for a view or a research direction without a full evaluation.', 'PaperType', { notation: 'PT-3' }),

      Preprint: T('Preprint', 'Preprint is a publication status for a paper made public before peer review.', 'PubStatus', { notation: 'S1' }),
      PeerReviewed: T('Peer reviewed', 'Peer reviewed is a publication status for a paper accepted after review by independent experts.', 'PubStatus', { notation: 'S2' }),
      Retracted: T('Retracted', 'Retracted is a publication status for a paper withdrawn by its authors or publisher after publication.', 'PubStatus', { notation: 'S3' }),

      NeuralSearch: Object.assign(newTerm('Neural search'), { definition: 'Neural search is a former name in the glossary for vector retrieval.', status: 'deprecated', replacedBy: 'VectorRetrieval', source: 'Reading group glossary' }),
    },
  }

  p.schemes = {
    Topic: { title: 'Research topics', description: 'What a paper is about. Two levels at most; the reading list filters on it.' },
    PaperType: { title: 'Paper types', description: 'What kind of contribution a paper makes.' },
    PubStatus: { title: 'Publication status', description: 'Where a paper is in its publication life.' },
  }
  p.collections = {
    GraphRagReadingOrder: { label: 'GraphRAG reading order', ordered: true, members: ['InformationRetrieval', 'RetrievalAugmentedGeneration', 'KnowledgeGraph', 'GraphRag'] },
    ExtractionTechniques: { label: 'Building a graph from text', ordered: false, members: ['EntityExtraction', 'RelationExtraction', 'CommunityDetection'] },
  }

  p.profile = {
    title: 'Paper record profile',
    appliesTo: 'papers on the reading list',
    elements: {
      title: { obligation: 'required', max: '1', encoding: 'text', schemes: [], guideline: 'The title as published, in sentence case.', example: 'Community summaries for corpus-wide questions' },
      identifier: { obligation: 'required', max: '1', encoding: 'text', schemes: [], guideline: 'The reading list key: RL- and a three-digit number.', example: 'RL-002' },
      issued: { obligation: 'required', max: '1', encoding: 'iso8601', schemes: [], guideline: 'Date the paper (or its first preprint) was made public.', example: '2024-04-24' },
      type: { obligation: 'required', max: '1', encoding: 'vocab', schemes: ['PaperType'], guideline: 'One paper type.', example: 'Research article' },
      subject: { obligation: 'recommended', max: 'many', encoding: 'vocab', schemes: ['Topic'], guideline: 'The topics the paper is mainly about; two or three at most.', example: 'Graph-based RAG' },
      creator: { obligation: 'optional', max: 'many', encoding: 'iri', schemes: [], guideline: 'Link to each author\'s record rather than typing the name.', example: 'Wei Tan' },
    },
    systems: ['Reference manager', 'Reading group wiki'],
    crosswalk: {
      title: { 'Reference manager': 'Title', 'Reading group wiki': 'page title' },
      identifier: { 'Reference manager': 'Citation key', 'Reading group wiki': 'page slug' },
      issued: { 'Reference manager': 'Date', 'Reading group wiki': 'published' },
      type: { 'Reference manager': 'Item type', 'Reading group wiki': 'kind' },
      subject: { 'Reference manager': 'Tags', 'Reading group wiki': 'topics' },
      creator: { 'Reference manager': 'Authors', 'Reading group wiki': 'authors' },
    },
  }

  const O = p.onto
  Object.assign(O, {
    title: 'Research knowledge graph ontology',
    version: '1.0.0',
    description: 'Papers, the methods they propose, the datasets they evaluate on, and the researchers and labs who write them, with topics, paper types and publication status kept as SKOS concepts.',
    creator: 'Reading group organizer',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    base: { concept: 'https://example.org/rkg/concept/', schema: 'https://example.org/rkg/schema#', data: 'https://example.org/rkg/data/' },
    prefix: { concept: 'rkgc', schema: 'rkg', data: 'rd' },
    reuse: ['prov', 'foaf', 'schema', 'dcat'],
    records: ['Paper'],
  })

  O.cqs = [
    { id: 'cq1', text: 'Which papers address retrieval-augmented generation, including its narrower topics?', sparql: PRE + `SELECT ?title ?topic WHERE {
  ?paper a rkg:Paper ; dct:title ?title ; rkg:topic ?t .
  ?t skos:broader* rkgc:RetrievalAugmentedGeneration ; skos:prefLabel ?topic .
} ORDER BY ?title` },
    { id: 'cq2', text: 'What does each method build on, directly or indirectly?', sparql: PRE + `SELECT ?m ?method ?b ?buildsOn WHERE {
  ?m rkg:extendsMethod+ ?b .
  ?m rdfs:label ?method . ?b rdfs:label ?buildsOn .
} ORDER BY ?method` },
    { id: 'cq3', text: 'Which datasets are graph-based methods evaluated on?', sparql: PRE + `SELECT DISTINCT ?dataset ?method WHERE {
  ?paper rkg:proposes ?m ; rkg:evaluatedOn ?d .
  ?m rkg:usesKnowledgeGraph true ; rdfs:label ?method .
  ?d dct:title ?dataset .
}` },
    { id: 'cq4', text: 'Who wrote peer-reviewed papers, and which lab are they in?', sparql: PRE + `SELECT DISTINCT ?author ?lab WHERE {
  ?paper rkg:status rkgc:PeerReviewed ; rkg:authoredBy ?a .
  ?a rdfs:label ?author ; rkg:affiliatedWith ?l .
  ?l rdfs:label ?lab .
} ORDER BY ?author` },
    { id: 'cq5', text: 'Which papers evaluate on more than one dataset?', sparql: PRE + `SELECT ?title (COUNT(?d) AS ?datasets) WHERE {
  ?paper rkg:evaluatedOn ?d ; dct:title ?title .
} GROUP BY ?title HAVING (COUNT(?d) > 1)` },
    { id: 'cq6', text: 'Which papers build on the dense-passage paper, directly or through the papers they cite?', sparql: PRE + `SELECT ?title WHERE {
  ?paper rkg:cites+ rd:paper-dense-passages ; dct:title ?title .
}` },
  ]

  const C = (label, comment, sub, extra = {}) => Object.assign({ label, comment, sub, disjoint: [], fromConcept: '', cq: '' }, extra)
  O.classes = {
    Paper: C('Paper', 'A written research contribution on the reading list: an article, a survey, a benchmark or a position paper. Its kind is a SKOS concept, not a subclass.', ['schema:ScholarlyArticle', 'prov:Entity'], { disjoint: ['Dataset'], cq: 'cq1' }),
    Researcher: C('Researcher', 'A person who writes papers on the reading list.', ['foaf:Person', 'prov:Agent'], { disjoint: ['Lab'], cq: 'cq4' }),
    Lab: C('Lab', 'A research group, company team or university department that researchers work in.', ['foaf:Organization'], { disjoint: ['Researcher'], cq: 'cq4' }),
    Method: C('Method', 'A technique a paper proposes: a retrieval pipeline, an indexing scheme, a way of building a graph. Methods build on earlier methods.', ['prov:Plan'], { cq: 'cq2' }),
    Dataset: C('Dataset', 'A collection of data papers evaluate on. Kept separate from papers so that evaluation can be traced to data.', ['dcat:Dataset'], { disjoint: ['Paper'], cq: 'cq3' }),
  }
  const P = (label, comment, domain, range, extra = {}) => Object.assign({ label, comment, domain, range, functional: false, transitive: false, inverse: '', sub: '', cq: '' }, extra)
  O.props = {
    authoredBy: P('authored by', 'A researcher who wrote the paper. Aligned to prov:wasAttributedTo so provenance tools read it.', 'Paper', 'Researcher', { inverse: 'authorOf', sub: 'prov:wasAttributedTo', cq: 'cq4' }),
    authorOf: P('author of', 'A paper the researcher wrote. The inverse of authored by.', 'Researcher', 'Paper', { inverse: 'authoredBy', cq: 'cq4' }),
    affiliatedWith: P('affiliated with', 'The lab the researcher works in. One lab per researcher in this graph.', 'Researcher', 'Lab', { functional: true, cq: 'cq4' }),
    proposes: P('proposes', 'A method the paper introduces.', 'Paper', 'Method', { cq: 'cq3' }),
    evaluatedOn: P('evaluated on', 'A dataset the paper\'s experiments use.', 'Paper', 'Dataset', { cq: 'cq3' }),
    extendsMethod: P('extends method', 'An earlier method this one builds on. Transitive: lineage carries through.', 'Method', 'Method', { transitive: true, cq: 'cq2' }),
    cites: P('cites', 'A paper on the reading list that this paper cites.', 'Paper', 'Paper', { cq: 'cq6' }),
    topic: P('topic', 'A topic the paper addresses, from the research topics scheme.', 'Paper', 'skos:Concept', { cq: 'cq1' }),
    status: P('publication status', 'Where the paper is in its publication life, from the publication status scheme.', 'Paper', 'skos:Concept', { functional: true, cq: 'cq4' }),
    publicationYear: P('publication year', 'The year the paper was first made public.', 'Paper', 'xsd:gYear', { functional: true }),
    usesKnowledgeGraph: P('uses knowledge graph', 'True when the method retrieves from a graph of entities and relations.', 'Method', 'xsd:boolean', { functional: true, cq: 'cq3' }),
  }
  O.shapes = {
    PaperAuthorShape: { target: 'Paper', path: ['authoredBy'], cls: 'Researcher', datatype: '', hasValue: '', min: '1', max: '', message: 'Every paper needs at least one author who is a Researcher.' },
    PaperTypeShape: { target: 'Paper', path: ['dct:type'], cls: '', datatype: '', hasValue: '', min: '1', max: '1', message: 'Every paper has exactly one paper type.' },
    AuthorLabShape: { target: 'Paper', path: ['authoredBy', 'affiliatedWith'], cls: 'Lab', datatype: '', hasValue: '', min: '1', max: '', message: 'At least one author must be affiliated with a lab, so the work can be traced to a group.' },
    MethodGraphFlagShape: { target: 'Method', path: ['usesKnowledgeGraph'], cls: '', datatype: 'xsd:boolean', hasValue: '', min: '1', max: '1', message: 'Every method states whether it uses a knowledge graph.' },
  }

  const ind = (types, label, vals, comment = '') => ({ types, label, comment, vals: vals.map(([p, k, v]) => ({ p, k, v })) })
  const paper = (label, id, issued, year, type, status, topics, authors, rest) =>
    ind(['Paper'], label, [
      ['dct:title', 'lit', label], ['dct:identifier', 'lit', id], ['dct:issued', 'lit', issued], ['dct:type', 'concept', type],
      ...topics.map((t) => ['dct:subject', 'concept', t]), ...topics.map((t) => ['topic', 'concept', t]),
      ['status', 'concept', status], ['publicationYear', 'lit', year],
      ...authors.map((a) => ['authoredBy', 'ind', a]), ...authors.map((a) => ['dct:creator', 'ind', a]),
      ...rest,
    ])
  O.individuals = {
    'lab-harbor': ind(['Lab'], 'Harbor Street AI Lab', [['foaf:homepage', 'lit', 'https://example.org/labs/harbor']]),
    'lab-northfield': ind(['Lab'], 'Northfield Data Group', []),
    'researcher-okafor': ind(['Researcher'], 'Ada Okafor', [['foaf:name', 'lit', 'Ada Okafor'], ['affiliatedWith', 'ind', 'lab-harbor']]),
    'researcher-lindqvist': ind(['Researcher'], 'Mats Lindqvist', [['foaf:name', 'lit', 'Mats Lindqvist'], ['affiliatedWith', 'ind', 'lab-northfield']]),
    'researcher-tan': ind(['Researcher'], 'Wei Tan', [['foaf:name', 'lit', 'Wei Tan'], ['affiliatedWith', 'ind', 'lab-harbor']]),
    'method-dense': ind(['Method'], 'Dense passage baseline', [['usesKnowledgeGraph', 'lit', 'false']], 'Embed passages, retrieve the nearest ones, and generate from them.'),
    'method-community': ind(['Method'], 'Community-summary retrieval', [['usesKnowledgeGraph', 'lit', 'true'], ['extendsMethod', 'ind', 'method-dense']], 'Build an entity graph, summarize its communities, and answer from the summaries.'),
    'method-local-global': ind(['Method'], 'Local-to-global graph retrieval', [['usesKnowledgeGraph', 'lit', 'true'], ['extendsMethod', 'ind', 'method-community']], 'Start from the entities a question names, then widen to their communities.'),
    'dataset-harbor-news': ind(['Dataset'], 'Harbor News QA', [['dct:title', 'lit', 'Harbor News QA'], ['dcat:keyword', 'lit', 'question answering'], ['dct:publisher', 'ind', 'lab-harbor']]),
    'dataset-lectures': ind(['Dataset'], 'Lecture Transcripts Corpus', [['dct:title', 'lit', 'Lecture Transcripts Corpus'], ['dcat:keyword', 'lit', 'long documents'], ['dct:publisher', 'ind', 'lab-northfield']]),
    'paper-dense-passages': paper('Grounding answers in dense passages', 'RL-001', '2023-03-14', '2023', 'ResearchArticle', 'PeerReviewed', ['VectorRetrieval', 'RetrievalAugmentedGeneration'], ['researcher-lindqvist'],
      [['proposes', 'ind', 'method-dense'], ['evaluatedOn', 'ind', 'dataset-harbor-news']]),
    'paper-community-summaries': paper('Community summaries for corpus-wide questions', 'RL-002', '2024-04-24', '2024', 'ResearchArticle', 'Preprint', ['GraphRag', 'CommunityDetection'], ['researcher-okafor', 'researcher-tan'],
      [['proposes', 'ind', 'method-community'], ['evaluatedOn', 'ind', 'dataset-harbor-news'], ['evaluatedOn', 'ind', 'dataset-lectures'], ['cites', 'ind', 'paper-dense-passages']]),
    'paper-local-global': paper('Local and global questions over entity graphs', 'RL-003', '2025-02-03', '2025', 'ResearchArticle', 'PeerReviewed', ['GraphRag', 'EntityExtraction'], ['researcher-tan'],
      [['proposes', 'ind', 'method-local-global'], ['evaluatedOn', 'ind', 'dataset-lectures'], ['cites', 'ind', 'paper-community-summaries']]),
    'paper-field-guide': paper('A field guide to graph-based retrieval', 'RL-004', '2025-09-10', '2025', 'Survey', 'PeerReviewed', ['GraphRag', 'KnowledgeGraph', 'OntologyEngineering'], ['researcher-lindqvist', 'researcher-okafor'],
      [['cites', 'ind', 'paper-community-summaries'], ['cites', 'ind', 'paper-local-global']]),
  }
  p.ui.sel = { term: 'GraphRag', concept: 'GraphRag', cls: 'Paper', prop: 'extendsMethod', ind: 'paper-community-summaries', shape: 'AuthorLabShape' }
  return p
}
