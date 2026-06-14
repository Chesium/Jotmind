import type { PortableKnowledgeBaseExport } from '@jotmind/schemas';

/**
 * Render a human-readable Markdown export (US-032 AC3). Explicitly labeled as
 * NOT a guaranteed full-fidelity round-trip — use the Portable JSON export for
 * backup/restore.
 */
export function renderMarkdownExport(exported: PortableKnowledgeBaseExport): string {
  const kb = exported.knowledgeBase;
  const d = exported.data;
  const lines: string[] = [];
  lines.push(`# ${kb.name} — Knowledge Base Export (Markdown)`);
  lines.push('');
  lines.push(`> **${exported.labels.markdown}**`);
  lines.push('');
  if (kb.description) {
    lines.push(kb.description);
    lines.push('');
  }
  lines.push(`Exported at: ${exported.exportedAt}`);
  lines.push('');
  lines.push(
    `Contains ${d.entities.length} entities, ${d.claims.length} claims, ` +
      `${d.notes.length} notes, ${d.sources.length} sources, ${d.citations.length} citations, ` +
      `${d.schemas.length} schemas, ${d.rules.length} rules.`,
  );
  lines.push('');

  if (d.entities.length > 0) {
    lines.push('## Entities');
    lines.push('');
    for (const e of d.entities) {
      const tags = e.tags.length ? ` _(tags: ${e.tags.join(', ')})_` : '';
      lines.push(`- **${e.name}** — ${e.type}${tags}`);
      if (e.description) lines.push(`  - ${e.description}`);
    }
    lines.push('');
  }

  if (d.claims.length > 0) {
    const entityNames = new Map(d.entities.map((e) => [e.id, e.name]));
    lines.push('## Claims');
    lines.push('');
    for (const c of d.claims) {
      const args = c.arguments
        .map((a) =>
          a.argumentKind === 'entity'
            ? `${a.role}: ${entityNames.get(a.entityId ?? '') ?? a.entityId ?? '?'}`
            : `${a.role}: ${JSON.stringify(a.value)}`,
        )
        .join(', ');
      lines.push(`- **${c.predicate}**(${args})`);
    }
    lines.push('');
  }

  if (d.notes.length > 0) {
    lines.push('## Notes');
    lines.push('');
    for (const n of d.notes) {
      lines.push(`### ${n.title ?? 'Untitled note'}`);
      lines.push('');
      lines.push(n.content);
      lines.push('');
    }
  }

  if (d.sources.length > 0) {
    lines.push('## Sources');
    lines.push('');
    for (const s of d.sources) {
      const uri = s.uri ? ` (${s.uri})` : '';
      lines.push(`- **${s.title ?? 'Untitled source'}**${uri}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Render the entities-only CSV structured subset (US-032 AC4). The leading
 * comment makes clear this is a subset, not a full-fidelity backup.
 */
export function renderEntitiesCsv(exported: PortableKnowledgeBaseExport): string {
  const lines: string[] = [];
  lines.push(`# ${exported.labels.csv}`);
  lines.push(['id', 'type', 'name', 'aliases', 'tags', 'description'].join(','));
  for (const e of exported.data.entities) {
    lines.push(
      [
        csvCell(e.id),
        csvCell(e.type),
        csvCell(e.name),
        csvCell(e.aliases.join('; ')),
        csvCell(e.tags.join('; ')),
        csvCell(e.description ?? ''),
      ].join(','),
    );
  }
  return lines.join('\n');
}
