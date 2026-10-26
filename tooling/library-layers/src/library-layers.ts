export type LibraryManifest = {
  name: string;
  dependencies?: Record<string, string> | undefined;
  devDependencies?: Record<string, string> | undefined;
};

type LibraryLayer = { name: string; libraries: string[] };

/**
 * The libraries in `libs/`, from the bottom layer up. A library may depend only on libraries in a
 * lower layer, so the account and grant owners reach the registry only through RPC, and libraries
 * of one layer stay independent of each other. `docs/architecture/README.md` draws the graph.
 */
export const LIBRARY_LAYERS: LibraryLayer[] = [
  {
    name: "foundations",
    libraries: [
      "@cup/api-rpc.client",
      "@cup/conversion-contracts",
      "@cup/errors",
      "@cup/mp3-encoding",
      "@cup/narration-document-creation",
      "@cup/prepare-source-material",
      "@cup/rolling-limits",
    ],
  },
  {
    name: "shared storage and production",
    libraries: [
      "@cup/audiobook-production",
      "@cup/duration-ledger",
      "@cup/narration-content-selection",
    ],
  },
  { name: "owners", libraries: ["@cup/accounts", "@cup/conversion-grants"] },
  {
    name: "coordination and API contracts",
    libraries: ["@cup/listener-api.routes", "@cup/operator-api.routes", "@cup/registry"],
  },
  {
    name: "API clients and conversion workflow",
    libraries: [
      "@cup/create-audiobook-from-url-workflow",
      "@cup/listener-api.client",
      "@cup/operator-api.client",
    ],
  },
  { name: "API server", libraries: ["@cup/api-server"] },
];

export function findLayerViolations(manifests: LibraryManifest[]): string[] {
  const layerIndexByLibrary = new Map(
    LIBRARY_LAYERS.flatMap((layer, index) =>
      layer.libraries.map((library) => [library, index] as const),
    ),
  );
  const libraryNames = new Set(manifests.map((manifest) => manifest.name));

  const violations: string[] = [];
  for (const manifest of manifests) {
    const layerIndex = layerIndexByLibrary.get(manifest.name);
    if (layerIndex === undefined) {
      violations.push(
        `\`${manifest.name}\` has no layer; add it to \`LIBRARY_LAYERS\` in \`tooling/library-layers/src/library-layers.ts\`.`,
      );
      continue;
    }

    const dependencyNames = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }).filter((dependency) => libraryNames.has(dependency));
    for (const dependency of dependencyNames) {
      const dependencyLayerIndex = layerIndexByLibrary.get(dependency);
      if (dependencyLayerIndex !== undefined && dependencyLayerIndex >= layerIndex) {
        violations.push(
          `\`${manifest.name}\` (${LIBRARY_LAYERS[layerIndex]?.name}) depends on \`${dependency}\` (${LIBRARY_LAYERS[dependencyLayerIndex]?.name}); a library may depend only on libraries in lower layers.`,
        );
      }
    }
  }
  return violations;
}
