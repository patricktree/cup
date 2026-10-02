import { Command, Option } from "@commander-js/extra-typings";
import childProcess from "node:child_process";
import process from "node:process";
import util from "node:util";
import { z } from "zod";

import { OperatorApiClient, parseOkResponse } from "@cup/operator-api.client";
import {
  isDevelopmentOperatorUrl,
  isLoopbackOperatorUrl,
  LOCAL_OPERATOR_ACCESS_TOKEN,
  projectedGrantStates,
  uuidV4Schema,
} from "@cup/operator-api.routes";

const execFile = util.promisify(childProcess.execFile);
const DEFAULT_LIMIT = 50;
const globalOptionsSchema = z.object({
  operatorUrl: z.string().optional(),
  json: z.boolean(),
  debug: z.boolean(),
});

const program = new Command()
  .name("operator")
  .description("Operate Cup conversion grants")
  .version("0.1.0")
  .option("--operator-url <url>", "operator service URL")
  .option("--json", "write one JSON value to stdout", false)
  .option("--debug", "include redacted diagnostic details", false)
  .showHelpAfterError();

const account = program.command("account").description("Inspect account lifecycle");
account
  .command("inspect")
  .argument("<account-id>")
  .action(async (accountId, _options, command) =>
    run(command, async (client, output) => {
      const result = await parseOkResponse(
        client.inspectAccount({ accountId: parseUuid(accountId) }),
      );
      output(result, () => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`));
    }),
  );
account.command("deletions").action(async (_options, command) =>
  run(command, async (client, output) => {
    const result = await parseOkResponse(client.listAccountDeletions());
    output(result, () => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`));
  }),
);
const grant = program.command("grant").description("Manage conversion grants");

grant
  .command("create")
  .requiredOption("--label <label>", "internal grant label")
  .option("--request-id <uuid>", "stable provisioning request ID")
  .action(async (options, command) => {
    const requestId = parseUuid(options.requestId ?? crypto.randomUUID());
    await run(command, async (client, output) => {
      try {
        const result = await parseOkResponse(
          client.createGrant({ label: options.label, requestId }),
        );
        output(result, () => {
          writeFields([
            ["Grant ID", result.grantId],
            ["Label", result.label],
            ["Created", result.createdAt],
            ["Expires", result.expiresAt],
            ["State (authoritative)", result.state],
            ["Request ID", result.requestId],
            ...(result.result === "issued" ? [["Trial link", result.trialLink] as const] : []),
          ]);
          if (result.result === "issued")
            process.stderr.write(
              "Warning: this trial link is shown once and cannot be recovered.\n",
            );
        });
      } catch (error) {
        throw new CliError(
          "create-failed",
          `Grant creation was not confirmed. Retry with --request-id ${requestId}.`,
          error,
        );
      }
    });
  });

grant
  .command("list")
  .option("--label <text>", "filter labels")
  .addOption(new Option("--state <state>", "filter projected state").choices(projectedGrantStates))
  .option("--limit <number>", "page size", String(DEFAULT_LIMIT))
  .option("--cursor <cursor>", "opaque pagination cursor")
  .action(async (options, command) =>
    run(command, async (client, output) => {
      const result = await parseOkResponse(
        client.listGrants({
          label: options.label,
          state: options.state,
          limit: parseInteger(options.limit),
          cursor: options.cursor,
        }),
      );
      output(result, () => {
        process.stdout.write("State source: Registry snapshot\n");
        for (const item of result.grants)
          writeFields([
            ["Grant ID", item.grantId],
            ["Label", item.label],
            ["State (projected)", item.state],
            ["Created", item.createdAt],
            ["Expires", item.expiresAt],
          ]);
        if (result.nextCursor !== undefined)
          process.stdout.write(`Next cursor: ${result.nextCursor}\n`);
      });
    }),
  );

grant
  .command("inspect")
  .argument("<grant-id>")
  .action(async (grantId, _options, command) =>
    run(command, async (client, output) => {
      const result = await parseOkResponse(client.inspectGrant({ grantId: parseUuid(grantId) }));
      output(result, () =>
        writeFields([
          ["Grant ID", result.authoritative.grantId],
          ["Label", result.registry.label],
          ["State (authoritative)", result.authoritative.state],
          ["Available minutes", result.authoritative.duration.availableMilliseconds / 60_000],
          ["Reserved minutes", result.authoritative.duration.reservedMilliseconds / 60_000],
          ["Spent minutes", result.authoritative.duration.spentMilliseconds / 60_000],
          ["Conversions", result.authoritative.conversions.length],
        ]),
      );
    }),
  );

grant
  .command("set-allowance")
  .argument("<grant-id>")
  .requiredOption("--minutes <number>", "total audio duration allowance in minutes")
  .action(async (grantId, options, command) => {
    const allowanceMilliseconds = z.coerce
      .number()
      .positive()
      .transform((minutes) => minutes * 60_000)
      .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
      .parse(options.minutes);
    await run(command, async (client, output) => {
      const result = await parseOkResponse(
        client.setGrantAllowance({ grantId: parseUuid(grantId) }, allowanceMilliseconds),
      );
      output(result, () =>
        writeFields([
          ["Grant ID", result.grant.grantId],
          ["Total allowance (minutes)", allowanceMilliseconds / 60_000],
          ["Available minutes", result.grant.duration.availableMilliseconds / 60_000],
          ["Changed", result.changed ? "yes" : "no"],
        ]),
      );
    });
  });

grant
  .command("revoke")
  .argument("<grant-id>")
  .requiredOption("--yes", "confirm irreversible revocation")
  .action(async (grantId, _options, command) =>
    run(command, async (client, output) => {
      const result = await parseOkResponse(client.revokeGrant({ grantId: parseUuid(grantId) }));
      output(result, () =>
        writeFields([
          ["Grant ID", result.grant.grantId],
          ["State (authoritative)", result.grant.state],
          ["Changed", result.changed ? "yes" : "no"],
        ]),
      );
    }),
  );

grant
  .command("migrate")
  .requiredOption("--yes", "confirm migration sweep")
  .action(async (_options, command) =>
    run(command, async (client, output) => {
      const result = await parseOkResponse(client.migrateGrants());
      output(result, () => {
        writeFields([
          ["Complete", result.complete ? "yes" : "no"],
          ["Registry schema", result.registryVersion],
        ]);
        for (const item of result.grants)
          writeFields([
            ["Grant ID", item.grantId],
            ["Result", item.success ? `schema ${item.schemaVersion}` : (item.error ?? "failed")],
          ]);
      });
      if (!result.complete) process.exitCode = 1;
    }),
  );

grant
  .command("invalidate-sessions")
  .argument("<grant-id>")
  .requiredOption("--reason <text>", "audit reason")
  .requiredOption("--yes", "confirm revocation and session invalidation")
  .action(async (grantId, options, command) =>
    run(command, async (client, output) => {
      const reason = z.string().trim().min(1).max(500).parse(options.reason);
      const result = await parseOkResponse(
        client.invalidateSessions({ grantId: parseUuid(grantId) }, reason),
      );
      output(result, () =>
        writeFields([
          ["Grant ID", result.grant.grantId],
          ["State (authoritative)", result.grant.state],
          ["Invalidated", result.invalidatedAt],
        ]),
      );
    }),
  );

async function run(
  command: { optsWithGlobals(): unknown },
  action: (client: OperatorApiClient, output: Output) => Promise<void>,
): Promise<void> {
  const global = globalOptionsSchema.parse(command.optsWithGlobals());
  try {
    const operatorUrl = global.operatorUrl ?? process.env["CREATE_AUDIOBOOK_FROM_URL_OPERATOR_URL"];
    if (operatorUrl === undefined)
      throw new CliError(
        "operator-url-required",
        "Use --operator-url or set CREATE_AUDIOBOOK_FROM_URL_OPERATOR_URL.",
      );
    const url = new URL(operatorUrl);
    if (url.protocol !== "https:" && !isLoopbackOperatorUrl(url))
      throw new CliError("invalid-operator-url", "The operator URL must use HTTPS.");
    const accessToken = await getAccessToken(url.toString());
    await action(new OperatorApiClient(url.toString(), accessToken), createOutput(global.json));
  } catch (error) {
    const cliError =
      error instanceof CliError
        ? error
        : new CliError("operator-error", "The operator request failed.", error);
    process.stderr.write(
      `${global.json ? JSON.stringify({ error: { code: cliError.code, message: cliError.message } }) : `Error: ${cliError.message}`}\n`,
    );
    if (global.debug && cliError.cause instanceof Error)
      process.stderr.write(`${redact(cliError.cause.message)}\n`);
    process.exitCode = 1;
  }
}

type Output = (value: unknown, human: () => void) => void;
function createOutput(isJson: boolean): Output {
  return (value, human) => (isJson ? process.stdout.write(`${JSON.stringify(value)}\n`) : human());
}

async function getAccessToken(operatorUrl: string): Promise<string> {
  if (isDevelopmentOperatorUrl(new URL(operatorUrl))) return LOCAL_OPERATOR_ACCESS_TOKEN;
  if (process.env["CREATE_AUDIOBOOK_FROM_URL_ACCESS_TOKEN"] !== undefined) {
    return process.env["CREATE_AUDIOBOOK_FROM_URL_ACCESS_TOKEN"];
  }
  try {
    const { stdout } = await execFile("cloudflared", ["access", "token", `-app=${operatorUrl}`]);
    const token = stdout.trim();
    if (token === "") throw new Error("cloudflared returned an empty token");
    return token;
  } catch (error) {
    throw new CliError(
      "access-authentication-required",
      `Cloudflare Access authentication failed. Run cloudflared access login ${operatorUrl} and retry.`,
      error,
    );
  }
}

function writeFields(fields: ReadonlyArray<readonly [string, string | number]>): void {
  for (const [label, value] of fields) process.stdout.write(`${label}: ${value}\n`);
  process.stdout.write("\n");
}
function parseUuid(value: string): string {
  return uuidV4Schema.parse(value);
}
function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100)
    throw new CliError("invalid-limit", "--limit must be an integer from 1 through 100.");
  return parsed;
}
function redact(value: string): string {
  return value
    .replace(/v1\.[A-Za-z0-9_-]{43}/g, "[REDACTED]")
    .replace(/(authorization|cookie|cf-access-token):?\s*\S+/gi, "$1: [REDACTED]");
}

class CliError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: unknown) {
    super(message, options === undefined ? undefined : { cause: options });
    this.name = "CliError";
    this.code = code;
  }
}

await program.parseAsync(process.argv);
