import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type TokenRingApp from "@tokenring-ai/app";
import { TerminalService } from "@tokenring-ai/terminal";
import { TerminalConfigSchema } from "@tokenring-ai/terminal/schema";
import fs from "fs-extra";
import PosixTerminalProvider from "../PosixTerminalProvider.ts";
import { PosixTerminalProviderOptionsSchema } from "../schema.ts";

/**
 * The interactive output buffer is capped at `scrollbackLimit` chars so a long-lived
 * session can't grow without bound; positions returned to callers stay absolute
 * (monotonically increasing) even though older output has been dropped.
 */
describe("PosixTerminalProvider scrollback cap", () => {
  const testDir = "/tmp/posix-terminal-scrollback-test";
  const activeSessions: string[] = [];
  let provider: PosixTerminalProvider;

  const app = {
    serviceOutput: () => {},
    serviceError: () => {},
  } as unknown as TokenRingApp;

  beforeEach(() => {
    fs.ensureDirSync(testDir);
    const terminalService = new TerminalService(TerminalConfigSchema.parse({ agentDefaults: { provider: "posix" } }), app);
    provider = new PosixTerminalProvider(
      app,
      terminalService,
      PosixTerminalProviderOptionsSchema.parse({ sandboxProvider: "auto", interactiveMode: "pipe", scrollbackLimit: 100 }),
    );
    activeSessions.length = 0;
  });

  afterEach(() => {
    for (const id of activeSessions) {
      try {
        provider.terminateSession(id);
      } catch {
        // ignore
      }
    }
    fs.removeSync(testDir);
  });

  async function startSession() {
    const sessionId = await provider.startInteractiveSession({
      workingDirectory: testDir,
      writablePaths: [testDir],
      readablePaths: [],
      isolation: "none",
    });
    activeSessions.push(sessionId);
    return sessionId;
  }

  async function waitUntil(predicate: () => boolean, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  it("trims the retained buffer but keeps positions absolute and monotonic", async () => {
    const sessionId = await startSession();

    // Emit well over the 100-char cap.
    provider.sendInput(sessionId, "for i in $(seq 1 50); do echo aaaaaaaaaa; done");

    await waitUntil(() => (provider.getSessionStatus(sessionId)?.outputLength ?? 0) > 300);

    const status = provider.getSessionStatus(sessionId)!;
    // outputLength tracks everything ever produced, not just what's retained.
    expect(status.outputLength).toBeGreaterThan(300);

    // Reading from the very start only returns what's still in the capped window.
    const fromStart = provider.collectOutput(sessionId, 0, { minInterval: 0, settleInterval: 0, maxInterval: 0 });
    expect(fromStart.output.length).toBeLessThanOrEqual(100);
    expect(fromStart.newPosition).toBe(status.outputLength);

    // Reading from a position inside the retained window returns exactly that suffix.
    const midPosition = status.outputLength - 20;
    const fromMid = provider.collectOutput(sessionId, midPosition, { minInterval: 0, settleInterval: 0, maxInterval: 0 });
    expect(fromMid.output.length).toBe(20);
    expect(fromMid.newPosition).toBe(status.outputLength);

    provider.terminateSession(sessionId);
  });
});
