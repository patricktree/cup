/* oxlint-disable node/no-process-env -- Global setup hands the certificate to the workers through the environment. */
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Read by `createWorkerEnvironment` in `fixtures.ts`, which serves the Worker with this pair. */
export const HTTPS_KEY_PATH_ENV_VAR_NAME = "CUP_E2E_HTTPS_KEY_PATH";
export const HTTPS_CERT_PATH_ENV_VAR_NAME = "CUP_E2E_HTTPS_CERT_PATH";

/**
 * Creates a self-signed certificate for `127.0.0.1`, so each test's Worker serves HTTPS as
 * production does. The grant session cookie carries the `__Secure-` prefix, and WebKit stores such
 * a cookie only from an HTTPS response, even on a loopback address where Chromium accepts it over
 * HTTP. The browsers skip certificate checks (`ignoreHTTPSErrors`), and the tests' own requests
 * trust the certificate through `NODE_EXTRA_CA_CERTS`, which Node reads when a worker process
 * starts: Playwright starts the workers after global setup with its environment.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cup-e2e-https-"));
  const keyPath = path.join(directory, "key.pem");
  const certPath = path.join(directory, "cert.pem");

  childProcess.execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  process.env[HTTPS_KEY_PATH_ENV_VAR_NAME] = keyPath;
  process.env[HTTPS_CERT_PATH_ENV_VAR_NAME] = certPath;
  process.env["NODE_EXTRA_CA_CERTS"] = certPath;

  return async () => {
    await fs.rm(directory, { recursive: true, force: true });
  };
}
