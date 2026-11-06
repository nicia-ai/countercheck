/** Parse valid JSON without silently overwriting duplicate object keys. */
export function parseStrictJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  let i = 0;
  const whitespace = () => {
    while (/\s/.test(text[i] ?? "") && i < text.length) i++;
  };
  const stringToken = (): string => {
    const start = i++;
    while (i < text.length) {
      const char = text[i++];
      if (char === "\\") i++;
      else if (char === '"') break;
    }
    return JSON.parse(text.slice(start, i)) as string;
  };
  const walk = (depth: number): void => {
    if (depth > 32) throw new SyntaxError("Ambiguous or overly nested JSON.");
    whitespace();
    if (text[i] === "{") {
      i++;
      whitespace();
      const keys = new Set<string>();
      while (text[i] !== "}") {
        const key = stringToken();
        if (keys.has(key)) throw new SyntaxError("Ambiguous or overly nested JSON.");
        keys.add(key);
        whitespace();
        i++;
        walk(depth + 1);
        whitespace();
        if (text[i] !== ",") break;
        i++;
        whitespace();
      }
      i++;
    } else if (text[i] === "[") {
      i++;
      whitespace();
      while (text[i] !== "]") {
        walk(depth + 1);
        whitespace();
        if (text[i] !== ",") break;
        i++;
        whitespace();
      }
      i++;
    } else if (text[i] === '"') stringToken();
    else {
      while (i < text.length && !/[\s,}\]]/.test(text[i]!)) i++;
    }
  };
  walk(0);
  return value;
}
