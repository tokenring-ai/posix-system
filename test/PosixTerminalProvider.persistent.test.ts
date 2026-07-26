import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import { TerminalConfigSchema } from "@tokenring-ai/terminal/schema";
import TerminalService from "@tokenring-ai/terminal/TerminalService";
import fs from "fs-extra";
import PosixTerminalProvider from "../PosixTerminalProvider";

describe("PosixTerminalProvider Persistent Sessions", () => {
  const testDir = "/tmp/posix-terminal-persistent-test";
  let app: any;
  let terminalService: TerminalService;
  let provider: PosixTerminalProvider;
  const activeSessions: string[] = [];

  beforeEach(() => {
    fs.ensureDirSync(testDir);
    app = createTestingApp();

    // Create proper TerminalService configuration
    const terminalConfig = TerminalConfigSchema.parse({
      agentDefaults: {
        provider: "test-provider",
        workingDirectory: testDir,
        bash: {
          cropOutput: 10000,
          timeoutSeconds: 60,
        },
        interactive: {
          minInterval: 1,
          settleInterval: 2,
          maxInterval: 30,
        },
      },
    });

    terminalService = new TerminalService(terminalConfig);
    app.addServices(terminalService);
    provider = new PosixTerminalProvider(app, terminalService, { sandboxProvider: "auto" });
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
    if (fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
  });

  async function startSession() {
    const sessionId = await provider.startInteractiveSession({
      timeoutSeconds: 0,
      workingDirectory: testDir,
      isolation: "none",
    });
    activeSessions.push(sessionId);
    return sessionId;
  }

  /** Wait until session output contains needle or timeout */
  async function waitForOutput(sessionId: string, needle: string, fromPosition = 0, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = provider.collectOutput(sessionId, fromPosition, {
        minInterval: 0,
        settleInterval: 0,
        maxInterval: 1,
      });
      if (result.output.includes(needle)) {
        return result;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return provider.collectOutput(sessionId, fromPosition, {
      minInterval: 0,
      settleInterval: 0,
      maxInterval: 1,
    });
  }

  it("should start and interact with a persistent session", async () => {
    const sessionId = await startSession();

    expect(sessionId).toMatch(/^term-\d+$/);

    const status = provider.getSessionStatus(sessionId);
    expect(status).toBeTruthy();
    expect(status?.running).toBe(true);

    provider.sendInput(sessionId, "echo hello");

    const output = await waitForOutput(sessionId, "hello");
    expect(output.output).toContain("hello");
    expect(output.newPosition).toBeGreaterThan(0);

    provider.terminateSession(sessionId);
    activeSessions.splice(activeSessions.indexOf(sessionId), 1);

    const statusAfter = provider.getSessionStatus(sessionId);
    expect(statusAfter).toBeNull();
  });

  it("should handle multiple concurrent sessions", async () => {
    const session1 = await startSession();
    const session2 = await startSession();

    expect(session1).not.toBe(session2);

    const status1 = provider.getSessionStatus(session1);
    const status2 = provider.getSessionStatus(session2);

    expect(status1?.running).toBe(true);
    expect(status2?.running).toBe(true);

    provider.terminateSession(session1);
    provider.terminateSession(session2);
    activeSessions.length = 0;
  });

  it("should track output position correctly", async () => {
    const sessionId = await startSession();

    provider.sendInput(sessionId, "echo first");
    const output1 = await waitForOutput(sessionId, "first");

    expect(output1.output).toContain("first");
    const pos1 = output1.newPosition;

    provider.sendInput(sessionId, "echo second");
    const output2 = await waitForOutput(sessionId, "second", pos1);

    expect(output2.output).toContain("second");
    expect(output2.output).not.toContain("first");

    provider.terminateSession(sessionId);
    activeSessions.splice(activeSessions.indexOf(sessionId), 1);
  });

  it("should support the none isolation level", () => {
    expect(provider.supportedIsolationLevels).toContain("none");
  });

  it("should handle non-existent session", () => {
    // sendInput/collectOutput throw synchronously for missing sessions
    expect(() => provider.sendInput("non-existent-session", "test")).toThrow("Session non-existent-session not found");

    expect(() =>
      provider.collectOutput("non-existent-session", 0, {
        minInterval: 0,
        settleInterval: 0,
        maxInterval: 1,
      }),
    ).toThrow("Session non-existent-session not found");

    const status = provider.getSessionStatus("non-existent-session");
    expect(status).toBeNull();
  });
});
