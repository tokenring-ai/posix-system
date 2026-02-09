import fs from "fs-extra";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import PosixTerminalProvider from "../PosixTerminalProvider";

describe("PosixTerminalProvider Persistent Sessions", () => {
  let testDir = "/tmp/posix-terminal-persistent-test";
  let provider!: PosixTerminalProvider;

  beforeEach(() => {
    fs.ensureDirSync(testDir);
    provider = new PosixTerminalProvider({workingDirectory: testDir});
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
  });

  it("should start and interact with a persistent session", async () => {
    // Start a session
    const sessionId = await provider.startPersistentSession("bash", [], {
      timeoutSeconds: 0,
    });

    expect(sessionId).toMatch(/^term-\d+$/);

    // Check session status
    const status = provider.getSessionStatus(sessionId);
    expect(status).toBeTruthy();
    expect(status?.running).toBe(true);

    // Send a command
    await provider.sendInput(sessionId, "echo hello\n");

    // Wait a bit for output
    await new Promise(resolve => setTimeout(resolve, 100));

    // Collect output
    const output = await provider.collectOutput(sessionId, 0, {
      minInterval: 0,
      settleInterval: 0,
      maxInterval: 1,
    });

    expect(output.output).toContain("hello");
    expect(output.newPosition).toBeGreaterThan(0);

    // Terminate session
    await provider.terminateSession(sessionId);

    // Verify session is gone
    const statusAfter = provider.getSessionStatus(sessionId);
    expect(statusAfter).toBeNull();
  });

  it("should handle multiple concurrent sessions", async () => {
    const session1 = await provider.startPersistentSession("bash", [], {
      timeoutSeconds: 0,
    });

    const session2 = await provider.startPersistentSession("bash", [], {
      timeoutSeconds: 0,
    });

    expect(session1).not.toBe(session2);

    const status1 = provider.getSessionStatus(session1);
    const status2 = provider.getSessionStatus(session2);

    expect(status1?.running).toBe(true);
    expect(status2?.running).toBe(true);

    await provider.terminateSession(session1);
    await provider.terminateSession(session2);
  });

  it("should track output position correctly", async () => {
    const sessionId = await provider.startPersistentSession("bash", [], {
      timeoutSeconds: 0,
    });

    await provider.sendInput(sessionId, "echo first\n");
    await new Promise(resolve => setTimeout(resolve, 100));

    const output1 = await provider.collectOutput(sessionId, 0, {
      minInterval: 0,
      settleInterval: 0,
      maxInterval: 1,
    });

    expect(output1.output).toContain("first");
    const pos1 = output1.newPosition;

    await provider.sendInput(sessionId, "echo second\n");
    await new Promise(resolve => setTimeout(resolve, 100));

    const output2 = await provider.collectOutput(sessionId, pos1, {
      minInterval: 0,
      settleInterval: 0,
      maxInterval: 1,
    });

    expect(output2.output).toContain("second");
    expect(output2.output).not.toContain("first");

    await provider.terminateSession(sessionId);
  });
});
