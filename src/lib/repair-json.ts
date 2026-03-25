/**
 * Attempt to repair truncated JSON by closing unclosed brackets/braces.
 *
 * Scans the string character-by-character, tracking:
 * - Whether we're inside a string literal (handling escaped quotes)
 * - A stack of unclosed `{` and `[`
 *
 * After scanning, it:
 * 1. Closes any incomplete string literal
 * 2. Removes trailing commas or colons that would cause parse errors
 * 3. Appends closing `]` / `}` in reverse stack order (LIFO)
 */
export function repairJson(truncated: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = []; // tracks unclosed '{' and '['

  for (let i = 0; i < truncated.length; i++) {
    const ch = truncated[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') stack.push('{');
    else if (ch === '[') stack.push('[');
    else if (ch === '}') stack.pop();
    else if (ch === ']') stack.pop();
  }

  let result = truncated;

  // Close incomplete string literal
  if (inString) {
    result += '"';
  }

  // Strip trailing characters that would break JSON after our repairs:
  // commas, colons, or incomplete key-value separators
  result = result.replace(/[,:\s]+$/, '');

  // Close unclosed brackets/braces in LIFO order
  for (let i = stack.length - 1; i >= 0; i--) {
    result += stack[i] === '{' ? '}' : ']';
  }

  return result;
}

/**
 * Try to parse a (possibly truncated) JSON string by first repairing it.
 * Returns the parsed value on success, or `null` if repair + parse still fails.
 */
export function tryParseJsonWithRepair<T>(raw: string): T | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(repairJson(raw)) as T;
  } catch {
    return null;
  }
}
