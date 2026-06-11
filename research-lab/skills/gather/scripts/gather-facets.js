export const meta = {
  name: 'gather-facets',
  description: 'Parallel facet coverage: one researcher per facet queries a curated notebook or the open web',
  phases: [{ title: 'Facets' }],
}

// args: {
//   topic: string,                the framed question or topic
//   facets: [{ key, query }],     one focused query per facet
//   notebookId: string or null,   when present, facets query the notebook; when absent, the open web
// }

const FINDING = {
  type: 'object',
  properties: {
    facet: { type: 'string' },
    findings: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['facet', 'findings', 'sources'],
}

const results = (await parallel(args.facets.map((f) => () =>
  agent(
    'Topic: ' + args.topic + '\nYour facet: ' + f.key + '\nQuery: ' + f.query + '\n\n' +
    (args.notebookId
      ? 'Query the NotebookLM notebook ' + args.notebookId + ' about your facet only, using the ' +
        'notebook-ask.sh script per your agent instructions.'
      : 'Research your facet on the open web: search, fetch the strongest sources, and extract findings.') +
    '\nReturn raw, cited findings for your facet only. Do not form a position - digesting is ' +
    'downstream work. List the source titles or URLs you relied on, and name any gaps you could not cover.',
    { label: 'facet:' + f.key, phase: 'Facets', schema: FINDING, agentType: 'research-lab:researcher' }
  )
))).filter(Boolean)

log(results.length + ' of ' + args.facets.length + ' facets returned')
return { topic: args.topic, facets: results }
