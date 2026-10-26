/**
 * Compares the entity-relationship diagrams in `docs/architecture/durable-object-storage.md` with
 * the Drizzle schemas they draw. A diagram names every table and draws one line per declared
 * foreign key, from the referenced table to the referencing one, labelled with the referencing
 * columns; columns stay in the schemas.
 */

export type SchemaOutline = {
  tables: string[];
  foreignKeys: string[];
};

/** The `tables` of a Drizzle Kit snapshot, as `generateSQLiteDrizzleJson` returns it. */
type DrizzleJson = {
  tables: Record<
    string,
    {
      name: string;
      foreignKeys: Record<string, { tableFrom: string; tableTo: string; columnsFrom: string[] }>;
    }
  >;
};

const RELATIONSHIP_LINE = /^(\w+)\s+[|o}{]{2}--[|o}{]{2}\s+(\w+)\s*:\s*"([^"]*)"$/;
const ENTITY_LINE = /^(\w+)$/;

export function outlineSchema(drizzleJson: DrizzleJson): SchemaOutline {
  const tables = Object.values(drizzleJson.tables);
  return {
    tables: tables.map((table) => table.name).sort(),
    foreignKeys: tables
      .flatMap((table) => Object.values(table.foreignKeys))
      .map((foreignKey) =>
        formatForeignKey(
          foreignKey.tableTo,
          foreignKey.tableFrom,
          foreignKey.columnsFrom.join(", "),
        ),
      )
      .sort(),
  };
}

/** Reads the first `erDiagram` block after the level-two heading `## <heading>`. */
export function readSchemaDiagram(markdown: string, heading: string): SchemaOutline {
  const section = markdown.split(/^## /m).find((part) => part.startsWith(`${heading}\n`));
  if (section === undefined) {
    throw new Error(`The Markdown has no section "## ${heading}".`);
  }
  const diagram = /```mermaid\nerDiagram\n([\s\S]*?)```/.exec(section)?.[1];
  if (diagram === undefined) {
    throw new Error(`The section "## ${heading}" has no Mermaid erDiagram block.`);
  }

  const tables = new Set<string>();
  const foreignKeys: string[] = [];
  for (const line of diagram.split("\n").map((rawLine) => rawLine.trim())) {
    if (line === "") {
      continue;
    }

    const [, referencedTable, referencingTable, columns] = RELATIONSHIP_LINE.exec(line) ?? [];
    if (referencedTable !== undefined && referencingTable !== undefined && columns !== undefined) {
      tables.add(referencedTable);
      tables.add(referencingTable);
      foreignKeys.push(formatForeignKey(referencedTable, referencingTable, columns));
      continue;
    }

    const [, entity] = ENTITY_LINE.exec(line) ?? [];
    if (entity !== undefined) {
      tables.add(entity);
      continue;
    }

    throw new Error(
      `The "## ${heading}" diagram has a line that is neither a table name nor a relationship: ${line}`,
    );
  }
  return { tables: [...tables].sort(), foreignKeys: foreignKeys.sort() };
}

function formatForeignKey(referencedTable: string, referencingTable: string, columns: string) {
  return `${referencedTable} ← ${referencingTable} (${columns})`;
}
