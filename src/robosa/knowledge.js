const STOP = new Set(
  'a an the and or of to for in on at is are was were be been being i me my you your yours we our it its this that those these how what why when where which who can could would should do does did have has had tell about more please detail details currently'.split(
    ' ',
  ),
);
const INTENTS = [
  [
    /\b(resume|cv|skills?|experience|career|carrer|carreer|education|expertise|employment)\b|(?:work|professional)\s+(?:history|background)/i,
    'resume experience skills career education employment work role positions engineer developer education technology',
    ['resume', 'profile'],
  ],
  [
    /\babout\s+(?:you|yourself)\b|\bwho are you\b|\bintroduce yourself\b|\byour background\b/i,
    'resume profile biography experience work role skills portfolio',
    ['resume', 'profile', 'portfolio'],
  ],
  [
    /\b(created|creation|built|origin|started|history)\b|how.*\b(build|made|develop)/i,
    'created creation built origin started history prototype technology developed process',
    ['project'],
  ],
  [
    /\b(building|projects?|working on|focused|focus)\b/i,
    'project building developing current product',
    ['project', 'portfolio'],
  ],
  [
    /\b(blogs?|writing|articles?|publications?)\b/i,
    'blog writing article publication author',
    ['writing'],
  ],
  [
    /\b(schedule|available|availability|meeting|meet|calendar)\b/i,
    'schedule availability available meeting timezone hours',
    ['availability'],
  ],
];

export function knowledgeWords(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/\b(?:carrer|carreer)\b/g, 'career')
      .match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu)
      ?.filter((word) => word.length > 2 && !STOP.has(word)) || []
  );
}

export function splitKnowledge(text, maxLength = 1200) {
  const paragraphs = String(text || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const chunks = [];
  let pending = '';
  for (const paragraph of paragraphs) {
    if (pending && pending.length + paragraph.length + 2 > maxLength) {
      chunks.push(pending);
      pending = '';
    }
    let remaining = paragraph;
    while (remaining.length > maxLength) {
      if (pending) {
        chunks.push(pending);
        pending = '';
      }
      const space = remaining.lastIndexOf(' ', maxLength);
      const end = space > maxLength / 2 ? space : maxLength;
      chunks.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trim();
    }
    pending = pending ? `${pending}\n\n${remaining}` : remaining;
  }
  if (pending) chunks.push(pending);
  return chunks;
}

function placeholder(value) {
  return /\[(?:problem|who|initial|next|technolog|how|a real|what works|your|insert|add |describe)/i.test(
    value,
  );
}

export function profileKnowledge(profile) {
  const items = [
    {
      id: 'profile',
      title: `${profile.displayName}'s introduction`,
      kind: 'profile',
      text: `${profile.headline}\n${profile.bio}`,
    },
  ];
  for (const [index, project] of (profile.projects || []).entries()) {
    if (!placeholder(project.summary))
      items.push({
        id: `project-${index}`,
        title: project.name,
        kind: 'project',
        text: `${project.name}: ${project.summary}`,
      });
  }
  for (const [index, text] of (profile.facts || []).entries()) {
    if (!placeholder(text))
      items.push({
        id: `fact-${index}`,
        title: 'Approved profile fact',
        kind: 'fact',
        text,
      });
  }
  return items;
}

export function retrieveKnowledge({
  profile,
  sources = [],
  message,
  history = [],
  now = Date.now(),
}) {
  const activeSources = sources.filter(
    (source) =>
      source.status === 'approved' &&
      (!source.validUntil ||
        Date.parse(`${source.validUntil}T23:59:59.999Z`) >= now),
  );
  const documents = [...profileKnowledge(profile), ...activeSources];
  const current = String(message || '');
  const followup =
    /\b(it|this|that|these|those|they|their|more)\b/i.test(current) ||
    /^(how|why)\b/i.test(current);
  const userTurns = history.filter((turn) => turn.role === 'user').slice(-3);
  const previous = followup
    ? userTurns
        .map((turn) => turn.text)
        .join(' ')
        .slice(-2000)
    : '';
  const contextQuery = `${previous} ${current}`.trim();
  const intent = INTENTS.find(([pattern]) => pattern.test(current));
  const terms = new Set(knowledgeWords(contextQuery));
  const expanded = new Set(knowledgeWords(intent?.[1] || ''));
  const chunks = documents.flatMap((document) =>
    splitKnowledge(document.text).map((text, index) => ({
      ...document,
      text,
      passageId: `${document.id}:${index}`,
    })),
  );
  const frequency = new Map();
  for (const chunk of chunks)
    for (const word of new Set(knowledgeWords(`${chunk.title} ${chunk.text}`)))
      frequency.set(word, (frequency.get(word) || 0) + 1);
  const ranked = chunks
    .map((chunk) => {
      const words = knowledgeWords(chunk.text);
      const counts = new Map();
      for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
      const titleWords = new Set(knowledgeWords(chunk.title));
      let score = 0;
      let matches = 0;
      for (const word of terms) {
        if (counts.has(word) || titleWords.has(word)) {
          matches++;
          const idf = Math.log(
            1 + (chunks.length + 1) / ((frequency.get(word) || 0) + 1),
          );
          const count = counts.get(word) || 0;
          score +=
            idf *
            (count / (count + 1.2 * (0.3 + words.length / 180)) +
              (titleWords.has(word) ? 2 : 0));
        }
      }
      for (const word of expanded) if (counts.has(word)) score += 0.2;
      const categoryMatch = intent?.[2].includes(chunk.kind);
      if (categoryMatch) score += 1.1;
      // General questions can use a matching category; specific ones need evidence.
      const relevant = matches > 0 || (categoryMatch && terms.size <= 2);
      return { ...chunk, score: relevant ? score : 0 };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score);
  const detailed =
    /\b(detail|details|explain|how|why|compare|story|history|timeline)\b/i.test(
      current,
    );
  const selected = ranked.slice(0, detailed ? 7 : 4);
  return { query: contextQuery, passages: selected, detailed };
}

export function knowledgeCitations(passages) {
  const seen = new Set();
  return passages
    .filter((passage) => !seen.has(passage.id) && seen.add(passage.id))
    .map(({ id, title, url, text }) => ({
      id,
      title,
      url: url || '',
      excerpt: text.slice(0, 400),
    }));
}
