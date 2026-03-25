export interface RepresentativeEntriesResponse {
  lexicalEntries: string[];
  message: string;
}

export function parseRepresentativeEntriesResponse(
  payload: unknown,
): RepresentativeEntriesResponse {
  if (typeof payload !== 'object' || payload === null) {
    return { lexicalEntries: [], message: '' };
  }

  const candidate = payload as {
    lexicalEntries?: unknown;
    lexical_entries?: unknown;
    message?: unknown;
  };

  const rawEntries = Array.isArray(candidate.lexicalEntries)
    ? candidate.lexicalEntries
    : Array.isArray(candidate.lexical_entries)
      ? candidate.lexical_entries
      : [];

  return {
    lexicalEntries: rawEntries.filter(
      (entry): entry is string =>
        typeof entry === 'string' && entry.trim().length > 0,
    ),
    message: typeof candidate.message === 'string' ? candidate.message.trim() : '',
  };
}
