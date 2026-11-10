import { run } from "#src/host.ts";

/**
 * The process of a suite run, identified by its process ID and its start time: macOS reuses process
 * IDs, so the ID alone can't tell a dead run from a later, unrelated process.
 */
export type RunOwner = {
  readonly pid: number;
  /** When the process started, to the second in local time, as `YYYYMMDDhhmmss`. */
  readonly startedAt: string;
};

/** Looks up when a process started, as in `RunOwner`; undefined when no such process runs. */
export type StartTimeLookup = (pid: number) => string | undefined;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A line of `ps -o pid=,lstart=` in the C locale, such as `73170 Tue Nov 10 09:03:07 2026`. The
 * start time comes from the kernel, so every reading of one process gives the same value.
 */
const START_TIME_LINE =
  /^\s*(\d+)\s+[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s*$/u;

/** This process as the owner of the devices it creates. */
export async function readRunOwner(): Promise<RunOwner> {
  const startedAt = parseProcessStartTimes(
    await readPs(["-o", "pid=,lstart=", "-p", String(process.pid)]),
  )(process.pid);
  if (startedAt === undefined) {
    throw new Error(`\`ps\` did not list this process, ${process.pid}.`);
  }
  return { pid: process.pid, startedAt };
}

/** Whether the owner's process still runs: the same ID with the same start time. */
export function isRunOwnerAlive(owner: RunOwner, startTimeOf: StartTimeLookup): boolean {
  return startTimeOf(owner.pid) === owner.startedAt;
}

/** Reads every running process's start time from one `ps` call. */
export async function readProcessStartTimes(): Promise<StartTimeLookup> {
  return parseProcessStartTimes(await readPs(["-axo", "pid=,lstart="]));
}

/** Parses the output of `ps -o pid=,lstart=`, throwing on a line it can't read. */
export function parseProcessStartTimes(stdout: string): StartTimeLookup {
  const startTimes = new Map<number, string>();
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const match = START_TIME_LINE.exec(line);
    const month = match === null ? -1 : MONTHS.indexOf(match[2] ?? "");
    if (match === null || month === -1) {
      throw new TypeError(`\`ps\` printed a line without a process ID and start time: ${line}`);
    }
    const [, pid, , day = "", hours = "", minutes = "", seconds = "", year = ""] = match;
    const startedAt = `${year}${String(month + 1).padStart(2, "0")}${day.padStart(2, "0")}${hours}${minutes}${seconds}`;
    startTimes.set(Number(pid), startedAt);
  }
  return (pid) => startTimes.get(pid);
}

async function readPs(args: readonly string[]): Promise<string> {
  // The C locale keeps `lstart`'s day and month names in English.
  const { stdout } = await run("ps", args, { env: { ...process.env, LC_ALL: "C" } });
  return stdout;
}
