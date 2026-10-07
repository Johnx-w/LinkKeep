// Read JSON-shaped hydration data without executing page JavaScript. Bare
// `undefined` is accepted outside strings; quoted captions remain untouched.
export function readPageState(html: string, name: string): unknown {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`(?:window\\.)?${escaped}\\s*=\\s*`, "u").exec(html);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const opening = html[start];
  if (opening !== "{" && opening !== "[") return undefined;
  let depth = 0;
  let quoted = false;
  let escape = false;
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (quoted) {
      if (escape) escape = false;
      else if (character === "\\") escape = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{" || character === "[") depth++;
    else if (character === "}" || character === "]") {
      if (--depth === 0) {
        const json = html.slice(start, index + 1).replace(/("(?:\\.|[^"\\])*"|\bundefined\b)/gu, (token) => token === "undefined" ? "null" : token);
        try { return JSON.parse(json); } catch { return undefined; }
      }
    }
  }
  return undefined;
}
