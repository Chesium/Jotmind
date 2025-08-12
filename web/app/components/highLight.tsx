export function highlight(text: string, q: string) {
  if (!q) return text;
  try {
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})`, "ig");
    return text.split(re).map((seg, i) =>
      i % 2 ? <mark key={i}>{seg}</mark> : <span key={i}>{seg}</span>
    );
  } catch { return text; }
}