const STOP_WORDS = new Set([
  'about',
  'and',
  'are',
  'can',
  'could',
  'for',
  'from',
  'have',
  'how',
  'into',
  'more',
  'that',
  'the',
  'this',
  'what',
  'when',
  'where',
  'with',
  'would',
  'you',
  'your',
]);

function normalizedWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function projectAnswer(profile, query) {
  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  const direct = projects.find((project) =>
    String(query || '')
      .toLowerCase()
      .includes(String(project.name || '').toLowerCase()),
  );
  if (direct) {
    return `${direct.name} is ${direct.summary || 'one of my current projects.'}`;
  }
  if (!projects.length) return '';
  return `I am currently focused on ${projects
    .map((project) => project.name)
    .join(' and ')}. ${projects[0].summary || ''}`.trim();
}

function bestFact(profile, query) {
  const queryWords = new Set(normalizedWords(query));
  if (!queryWords.size) return '';

  let best = { score: 0, fact: '' };
  for (const fact of Array.isArray(profile.facts) ? profile.facts : []) {
    const score = normalizedWords(fact).reduce(
      (total, word) => total + (queryWords.has(word) ? 1 : 0),
      0,
    );
    if (score > best.score) best = { score, fact };
  }
  return best.score > 0 ? best.fact : '';
}

export function answerTwin(profile, input) {
  const query = String(input || '').trim();
  const text = query.toLowerCase();
  const displayName = profile.displayName || 'this person';

  if (!query) {
    return {
      text: `Ask me about ${displayName}'s work, current projects, or availability.`,
      action: null,
    };
  }

  if (
    includesAny(text, [
      'meeting',
      'meet ',
      'calendar',
      'schedule',
      'available',
      'availability',
      'book',
    ])
  ) {
    if (!profile.allowBooking) {
      return {
        text: `${displayName} is not accepting meeting requests through this twin right now. I can still share information about the work.`,
        action: null,
      };
    }
    return {
      text: `I can help you request a conversation with ${displayName}. I only show proposed times, never private calendar details.`,
      action: 'booking',
    };
  }

  if (
    includesAny(text, ['hello', 'hey', 'hi ', 'good morning', 'good afternoon'])
  ) {
    return {
      text: `Hello. I am ${displayName}'s AI representative. I can talk about the work, current projects, and meeting requests.`,
      action: null,
    };
  }

  if (
    includesAny(text, [
      'who are you',
      'about you',
      'about nazmul',
      'introduce yourself',
    ])
  ) {
    return {
      text: `${profile.bio} I am an AI representative, so I only answer from information ${displayName} has approved.`,
      action: null,
    };
  }

  if (includesAny(text, ['robosa', 'digital twin'])) {
    const project = profile.projects?.find((item) =>
      item.name.toLowerCase().includes('robosa'),
    );
    return {
      text:
        project?.summary ||
        'Robosa.me is an owner-controlled digital twin that can talk, share approved knowledge, and help with practical tasks.',
      action: null,
    };
  }

  if (
    includesAny(text, [
      'project',
      'building',
      'build ',
      'working on',
      'work on',
    ])
  ) {
    return {
      text: projectAnswer(profile, query),
      action: null,
    };
  }

  if (
    includesAny(text, [
      'skill',
      'expertise',
      'experience',
      'collaborate',
      'collaboration',
    ])
  ) {
    return {
      text: `${profile.headline}. ${profile.facts?.[1] || profile.bio}`,
      action: null,
    };
  }

  const fact = bestFact(profile, query);
  if (fact) return { text: fact, action: null };

  return {
    text: `I do not have an approved answer for that yet. I can tell you about ${displayName}'s work and projects, or help request a meeting.`,
    action: null,
  };
}

export function suggestedQuestions(profile) {
  const projectName = profile.projects?.[0]?.name;
  return [
    'What are you building?',
    projectName ? `Tell me about ${projectName}` : 'Tell me about your work',
    'Can we meet next week?',
  ];
}
