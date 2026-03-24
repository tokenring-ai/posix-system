import fs from "fs-extra";
import {beforeEach, describe, expect, it, vi} from "vitest";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp";
import TerminalService from "@tokenring-ai/terminal/TerminalService";
import {TerminalConfigSchema} from "@tokenring-ai/terminal/schema";
import PosixTerminalProvider from "../PosixTerminalProvider";

// Mock bun-pty before importing PosixTerminalProvider
vi.mock('bun-pty', () => ({
  spawn: vi.fn().mockImplementation(() => ({
    pid: 12345,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
  })),
}));

/**
 * Integration tests for PosixTerminalProvider that test the complete flow
 * including command execution and edge cases.
 */
describe("PosixTerminalProvider Integration Tests", () => {
  let testDir = "/tmp/posix-terminal-test";
  let app: any;
  let terminalService: TerminalService;
  let service: PosixTerminalProvider;

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
    service = new PosixTerminalProvider(app, terminalService, {isolation: "none"});
  });

  describe("Shell Commands", () => {
    it("should run shell commands", async () => {
      // Simple command test
      const result = await service.runScript("echo hello", { timeoutSeconds: 5, workingDirectory: testDir });
      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.output).toBe("hello");
      }
    });

    it("should handle command errors gracefully", async () => {
      // Command that should fail
      const result = await service.runScript("false", { timeoutSeconds: 5, workingDirectory: testDir });
      expect(result.status).toBe("badExitCode");
      if (result.status === "badExitCode") {
        expect(result.exitCode).toBe(1);
      }
    });

    it("should handle command execution with executeCommand", async () => {
      const result = await service.executeCommand("echo", ["test"], { timeoutSeconds: 5, workingDirectory: testDir });
      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.output).toBe("test");
      }
    });
  });
});
