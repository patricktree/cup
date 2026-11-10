// Removes the emulators and simulators that killed suite runs left behind, without starting a run.
// Each platform's global setup does the same before its run.
import { stopOrphanedEmulators } from "#src/android/emulator.ts";
import { deleteOrphanedSimulators } from "#src/ios/simulator.ts";

await stopOrphanedEmulators();
await deleteOrphanedSimulators();
