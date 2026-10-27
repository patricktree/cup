/**
 * Renders the entity-relationship diagram of a Drizzle schema into
 * `docs/architecture/durable-object-storage.md`. A diagram names every table and draws one line per
 * declared foreign key, from the referenced table to the referencing one, labelled with the
 * referencing columns; columns stay in the schemas.
 */

import zlib from "node:zlib";

/** The `tables` of a Drizzle Kit snapshot, as `generateSQLiteDrizzleJson` returns it. */
type DrizzleJson = {
  tables: Record<
    string,
    {
      name: string;
      columns: Record<string, { name: string; primaryKey: boolean }>;
      compositePrimaryKeys: Record<string, { columns: string[] }>;
      indexes: Record<string, { columns: string[]; isUnique: boolean; where?: string | undefined }>;
      uniqueConstraints: Record<string, { columns: string[] }>;
      foreignKeys: Record<string, { tableFrom: string; tableTo: string; columnsFrom: string[] }>;
    }
  >;
};

/** Renders the Mermaid `erDiagram` block, including its code fence, and a Mermaid Live link to it. */
export function renderSchemaDiagram(drizzleJson: DrizzleJson): string {
  const tables = Object.values(drizzleJson.tables);
  const foreignKeys = tables.flatMap((table) =>
    Object.values(table.foreignKeys).map((foreignKey) => ({ table, foreignKey })),
  );
  // `sort()` without a comparator orders by code unit, so the page does not depend on the locale.
  const relationshipLines = foreignKeys
    .map(({ table, foreignKey }) => {
      // A referencing row that the foreign key columns identify uniquely makes it one-to-one.
      const cardinality = isUniqueKey(table, foreignKey.columnsFrom) ? "||--o|" : "||--o{";
      return `${foreignKey.tableTo} ${cardinality} ${foreignKey.tableFrom} : "${foreignKey.columnsFrom.join(", ")}"`;
    })
    .sort();
  const relatedTables = new Set(
    foreignKeys.flatMap(({ foreignKey }) => [foreignKey.tableTo, foreignKey.tableFrom]),
  );
  const unrelatedTables = tables
    .map((table) => table.name)
    .filter((name) => !relatedTables.has(name))
    .sort();

  const lines = [...unrelatedTables, ...relationshipLines];
  const code = ["erDiagram", ...lines.map((line) => `    ${line}`)].join("\n");
  return [
    "```mermaid",
    code,
    "```",
    "",
    `[Open this diagram in Mermaid Live](${createMermaidLiveUrl(code)})`,
  ].join("\n");
}

/**
 * Returns the diagram of `store` in `markdown`: the lines between the `<!-- schema-diagram:<store>
 * -->` and `<!-- /schema-diagram:<store> -->` markers.
 */
export function readSchemaDiagram(markdown: string, store: string): string {
  const { start, end } = findDiagram(markdown, store);
  return markdown.slice(start, end);
}

/** Replaces the diagram of `store` in `markdown` with `diagram`. */
export function writeSchemaDiagram(markdown: string, store: string, diagram: string): string {
  const { start, end } = findDiagram(markdown, store);
  return markdown.slice(0, start) + diagram + markdown.slice(end);
}

function findDiagram(markdown: string, store: string) {
  const startMarker = `<!-- schema-diagram:${store} -->\n\n`;
  const endMarker = `\n\n<!-- /schema-diagram:${store} -->`;
  const startMarkerIndex = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker);
  if (startMarkerIndex === -1 || end < startMarkerIndex) {
    throw new Error(
      `The Markdown has no "${startMarker.trim()}" … "${endMarker.trim()}" block for the ${store} schema diagram.`,
    );
  }
  return { start: startMarkerIndex + startMarker.length, end };
}

/**
 * Mermaid Live reads its editor state from the URL fragment as zlib-deflated, base64url-encoded
 * JSON. The state matches the links next to the hand-written diagrams in `docs/architecture`.
 */
function createMermaidLiveUrl(code: string) {
  const state = {
    code,
    mermaid: JSON.stringify({ theme: "redux-color" }, null, 2),
    updateDiagram: true,
    grid: true,
    panZoom: true,
    rough: false,
  };
  return `https://mermaid.live/view#pako:${zlib.deflateSync(JSON.stringify(state)).toString("base64url")}`;
}

function isUniqueKey(table: DrizzleJson["tables"][string], columns: string[]) {
  const key = [...columns].sort().join();
  const primaryKeyColumns = Object.values(table.columns)
    .filter((column) => column.primaryKey)
    .map((column) => column.name);
  const uniqueColumnSets = [
    primaryKeyColumns,
    ...Object.values(table.compositePrimaryKeys).map((primaryKey) => primaryKey.columns),
    ...Object.values(table.uniqueConstraints).map((constraint) => constraint.columns),
    // A partial unique index allows duplicates outside its condition.
    ...Object.values(table.indexes)
      .filter((index) => index.isUnique && index.where === undefined)
      .map((index) => index.columns),
  ];
  return uniqueColumnSets.some((uniqueColumns) => [...uniqueColumns].sort().join() === key);
}
