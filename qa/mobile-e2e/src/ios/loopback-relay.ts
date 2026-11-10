import net from "node:net";

import { run } from "#src/host.ts";

export type LoopbackRelay = {
  close(): Promise<void>;
};

/**
 * Relays `[::1]:<port>` to `127.0.0.1:<port>`, unless this process already listens there. The iOS
 * simulator shares the host's loopback and connects to `localhost` over `::1` first, falling back
 * to `127.0.0.1` only when nothing listens on `::1`. The test Worker listens on `127.0.0.1` alone,
 * so without the relay another process holding the same port on `::1` would receive the app's
 * requests. The fake auth provider listens on both loopbacks itself. Returns undefined when another
 * process listens on `[::1]:<port>`.
 */
export async function startLoopbackRelay(port: number): Promise<LoopbackRelay | undefined> {
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket): void => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };
  const server = net.createServer((client) => {
    const upstream = net.connect(port, "127.0.0.1");
    track(client);
    track(upstream);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.pipe(upstream).pipe(client);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "::1", resolve);
    });
  } catch (error) {
    if (await isListeningInThisProcess(port)) {
      return { close: () => Promise.resolve() };
    }
    if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") {
      return undefined;
    }
    throw error;
  }
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

async function isListeningInThisProcess(port: number): Promise<boolean> {
  // lsof exits with 1 when nothing matches, and prints nothing then.
  const { exitCode, stdout, stderr } = await run(
    "lsof",
    ["-nP", "-a", `-iTCP@[::1]:${port}`, "-sTCP:LISTEN", "-t"],
    { successExitCodes: [0, 1] },
  );
  if (exitCode === 1) {
    if (stdout !== "" || stderr !== "") {
      throw new Error(`lsof failed for [::1]:${port}.\n${stdout}${stderr}`);
    }
    return false;
  }
  return stdout.split("\n").includes(String(process.pid));
}
