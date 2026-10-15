import type { GrantRegistrySnapshot } from "@cup/conversion-grants";

type GrantSummary = {
  grantId: string;
  requestId: string;
  label: string;
  createdAtMs: number;
  expiresAtMs: number;
};

type ProvisioningEntry = GrantSummary & {
  phase: "reserved" | "initialized" | "active";
  credentialIssued: boolean;
  grantSnapshot?: GrantRegistrySnapshot;
};

export type CreateConversionGrantResult =
  | ({ result: "already-issued" } & GrantSummary)
  | ({ result: "issued"; credential: string } & GrantSummary);

export type CreateConversionGrantDependencies = {
  registry: {
    reserveProvisioning(
      requestId: string,
      label: string,
    ): Promise<{ entry: ProvisioningEntry; created: boolean }>;
    activate(
      requestId: string,
      grantSnapshot: GrantRegistrySnapshot,
      credentialIssued: boolean,
    ): Promise<ProvisioningEntry>;
  };
  getGrant(grantId: string): {
    initialize(
      grantId: string,
      createdAtMs: number,
      expiresAtMs: number,
    ): Promise<GrantRegistrySnapshot>;
    installCredentialVerifier(
      verifier: string,
      issuedAtMs: number,
    ): Promise<"installed" | "already-issued">;
  };
  createRootCredential(): Promise<{ credential: string; verifier: string }>;
};

/** Provisions a conversion grant and issues its one-time root credential. */
export async function createConversionGrant(
  input: { label: string; requestId: string; issuedAtMs: number },
  dependencies: CreateConversionGrantDependencies,
): Promise<CreateConversionGrantResult> {
  const reservation = await dependencies.registry.reserveProvisioning(input.requestId, input.label);
  const entry = reservation.entry;

  if (entry.credentialIssued) {
    return { result: "already-issued", ...toGrantSummary(entry) };
  }

  const grant = dependencies.getGrant(entry.grantId);
  const grantSnapshot = await grant.initialize(entry.grantId, entry.createdAtMs, entry.expiresAtMs);
  await dependencies.registry.activate(input.requestId, grantSnapshot, false);

  const rootCredential = await dependencies.createRootCredential();
  const installation = await grant.installCredentialVerifier(
    rootCredential.verifier,
    input.issuedAtMs,
  );
  const active = await dependencies.registry.activate(
    input.requestId,
    grantSnapshot,
    installation === "installed",
  );

  return installation === "already-issued"
    ? { result: "already-issued", ...toGrantSummary(active) }
    : { result: "issued", credential: rootCredential.credential, ...toGrantSummary(active) };
}

function toGrantSummary(entry: ProvisioningEntry): GrantSummary {
  return {
    grantId: entry.grantId,
    requestId: entry.requestId,
    label: entry.label,
    createdAtMs: entry.createdAtMs,
    expiresAtMs: entry.expiresAtMs,
  };
}
