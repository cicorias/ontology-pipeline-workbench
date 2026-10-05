# Ontology Workbench

A local, offline workbench for building a knowledge graph in six stages:

1. **Controlled vocabulary**: purpose, sources, terms with preferred and alternative labels, definitions, status
2. **Metadata profile**: Dublin Core elements with obligation, cardinality, encoding, guidelines, and a crosswalk to your systems
3. **Taxonomy**: SKOS concept schemes and a hierarchy where every parent passes the is-a test
4. **Thesaurus**: related concepts, scope notes, hidden labels, mappings to outside vocabularies, collections
5. **Ontology**: competency questions and namespaces (CBox), classes, properties and SHACL shapes (TBox), test individuals (ABox), then a Check
6. **Knowledge graph**: SPARQL over everything, and a force-directed drawing of the graph or of one query's answer

All work is saved in your browser's localStorage. Export the RDF (Turtle, N-Triples, JSON-LD), the vocabulary as CSV, or the whole project as JSON.

A step-by-step guide with screenshots is in [docs/HOWTO.md](docs/HOWTO.md).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Or build a static copy (works from any static file server, no backend):

```bash
npm run build
npx vite preview   # serves dist/
```

`npm test` runs the built-in example through every engine in Node (RDF generation, reasoning, SHACL, all competency queries, and a deliberately broken copy that must be caught).

## What does the work

| Concern | Library |
| --- | --- |
| SPARQL 1.1 (paths, aggregates, CONSTRUCT, ASK) | [Oxigraph](https://github.com/oxigraph/oxigraph), compiled to WebAssembly |
| SHACL validation | [rdf-validate-shacl](https://github.com/zazuko/rdf-validate-shacl) |
| Turtle / N-Triples | [N3.js](https://github.com/rdfjs/N3.js) |
| Graph drawing | [d3-force](https://d3js.org) |
| Reasoning | `src/reason.js`: RDFS (subclass, subproperty, domain, range), `owl:inverseOf`, `owl:TransitiveProperty`, plus consistency checks for `owl:FunctionalProperty`, `owl:disjointWith` and literal datatypes |

The SPARQL page can query either the asserted triples or the asserted plus inferred triples, since Oxigraph does not reason by itself.

## Layout

```
src/
  vocab.js     namespaces, Dublin Core elements, reusable standards (PROV-O, FOAF, Schema.org, DCAT)
  state.js     project model and localStorage persistence
  example.js   the built-in example: a fictional GraphRAG research reading list
  rdf.js       project → RDF quads per layer (CBox/TBox/ABox), SHACL shapes, serializers
  reason.js    forward-chaining reasoner and consistency checks
  engine.js    SPARQL (Oxigraph) and SHACL (rdf-validate-shacl)
  checks.js    per-stage quality checklists and "what's still needed"
  graph.js     d3 force graph
  main.js      UI: views, actions, event wiring
test/smoke.mjs end-to-end check of the engines in Node
```

## Using it with a GraphRAG pipeline

Export the **Everything** layer as Turtle and load it into your graph store (Neo4j with n10s, GraphDB, Fuseki, Oxigraph server, or `rdflib` in Python). The SKOS layer gives your entity extractor a controlled label set (preferred, alternative and hidden labels), the TBox gives it the allowed entity and relation types, and the SHACL shapes can validate what an LLM extracts before it enters the graph.
