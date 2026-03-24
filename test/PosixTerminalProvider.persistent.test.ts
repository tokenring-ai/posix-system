import fs from "fs-extra";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp";
import TerminalService from "@tokenring-ai/terminal/TerminalService";
import {TerminalConfigSchema} from "@tokenring-ai/terminal/schema";
import PosixTerminalProvider from "../PosixTerminalProvider";

// Mock bun-pty before importing PosixTerminalProvider
const mockOnDataCallbacks: Map<string, (data: string) => void> = new Map();
const mockOnExitCallbacks: Map<string, (exitInfo: {exitCode: number}) => void> = new Map();

vi.mock('bun-pty', () => ({
  spawn: vi.fn().mockImplementation(function(this: any, command: string, args: string[], options: any) {
    const pid = Math.floor(Math.random() * 100000) + 1000;
    let exitCode: number | undefined = undefined;
    
    return {
      pid,
      onData: vi.fn((callback: (data: string) => void) => {
        mockOnDataCallbacks.set(pid, callback);
      }),
      onExit: vi.fn((callback: (info: {exitCode: number}) => void) => {
        mockOnExitCallbacks.set(pid, callback);
      }),
      write: vi.fn((data: string) => {
        // Simulate command execution and output
        if (data.includes('echo')) {
          const match = data.match(/echo\s+(.+)/);
          if (match) {
            const output = match[1].trim() + '\n';
            const callback = mockOnDataCallbacks.get(pid);
            if (callback) {
              callback(output);
            }
          }
        }
      }),
      kill: vi.fn(() => {
        exitCode = 0;
        const callback = mockOnExitCallbacks.get(pid);
        if (callback) {
          callback({exitCode: 0});
        }
      }),
    };
  }),
}));

describe("PosixTerminalProvider Persistent Sessions", () => {
  let testDir = "/tmp/posix-terminal-persistent-test";
  let app: any;
  let terminalService: TerminalService;
  let provider: PosixTerminalProvider;

  beforeEach(() => {
    fs.ensureDirSync(testDir);
    app = createTestingApp();
    
    // Create proper TerminalService configuration
    const terminalConfig = TerminalConfigSchema.parse({
      agentDefaults: {
        provider: 'test-provider',
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
      providers: {},
    });
    
    terminalService = new TerminalService(terminalConfig);
    app.addServices(terminalService);
    provider = new PosixTerminalProvider(app, terminalService, {isolation: "none"});
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
    mockOnDataCallbacks.clear();
    mockOnExitCallbacks.clear();
  });

  it("should start and interact with a persistent session", async () => {
    // Start a session
    const sessionId = await provider.startInteractiveSession({
      timeoutSeconds: 0,
      workingDirectory: testDir,
    });

    expect(sessionId).toMatch(/^term-\d+$/);

    // Check session status
    const status = provider.getSessionStatus(sessionId);
    expect(status).toBeTruthy();
    expect(status?.running).toBe(true);

    // Send a command
    await provider.sendInput(sessionId, "echo hello");

    // Wait a bit for output
    await new Promise(resolve => setTimeout(resolve, 100));

    // Collect output
    const output = await provider.collectOutput(sessionId, 0, {
      minInterval: 0,
      settleInterval: 0,
      maxInterval: 1,
    });

    // With the mock, we expect output to contain "hello"
    expect(output.output).toContain("hello");
    expect(output.newPosition).toBeGreaterThan(0);

    // Terminate session
    await provider.terminateSession(sessionId);

    // Verify session is gone
    const statusAfter = provider.getSessionStatus(sessionId);
    expect(statusAfter).toBeNull();
  });

  it("should handle multiple concurrent sessions", async () => {
    const session1 = await provider.startInteractiveSession({
      timeoutSeconds: 0,
      workingDirectory: testDir,
    });

    const session2 = await provider.startInteractiveSession({
      timeoutSeconds: 0,
      workingDirectory: testDir,
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
    const sessionId = await provider.startInteractiveSession({
      timeoutSeconds: 0,
      workingDirectory: testDir,
    });

    await provider.sendInput(sessionId, "echo first");
    await new Promise(resolve => setTimeout(resolve, 100));

    const output1 = await provider.collectOutput(sessionId, 0, {
      minInterval: 0,
      settleInterval: 0,
      maxInterval: 1,
    });

    expect(output1.output).toContain("first");
    const pos1 = output1.newPosition;

    await provider.sendInput(sessionId, "echo second");
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

  it("should return correct isolation level", () => {
    const isolationLevel = provider.getIsolationLevel();
    expect(isolationLevel).toBe("none");
  });

  it("should handle non-existent session", async () => {
    await expect(provider.sendInput("non-existent-session", "test"))
      .rejects
      .toThrow("Session non-existent-session not found");

    await expect(provider.collectOutput("non-existent-session", 0, {
      minInterval: 0,
      settleInterval: 0,
      maxInterval: 1,
    }))
      .rejects
      .toThrow("Session non-existent-session not found");

    const status = provider.getSessionStatus("non-existent-session");
    expect(status).toBeNull();
  });
});
