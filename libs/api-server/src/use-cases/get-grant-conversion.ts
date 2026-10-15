import {
  derivePreparedConversionStatus,
  type SegmentUsage,
} from "@cup/conversion-contracts/duration-accounting";
import { toGrantConversionSnapshot, type GrantConversion } from "@cup/conversion-grants";
import type { ConversionDetail } from "@cup/web-app-api.routes";

export type GetGrantConversionDependencies = {
  getConversion(conversionId: string): Promise<GrantConversion | undefined>;
  listAudioSegments(conversionId: string): Promise<readonly Pick<SegmentUsage, "state">[]>;
};

export async function getGrantConversion(
  conversionId: string,
  dependencies: GetGrantConversionDependencies,
): Promise<ConversionDetail | undefined> {
  const conversion = await dependencies.getConversion(conversionId);
  if (conversion === undefined) {
    return undefined;
  }
  const snapshot = toGrantConversionSnapshot(conversion);
  if (snapshot.status === "pending") {
    return { ...snapshot, lastStartedPhase: conversion.lastStartedPhase };
  }
  if (snapshot.status === "failed") {
    return snapshot;
  }
  return {
    ...snapshot,
    status: derivePreparedConversionStatus(await dependencies.listAudioSegments(conversionId)),
  };
}
