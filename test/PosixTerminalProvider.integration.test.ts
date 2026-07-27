import { beforeEach, describe, expect, it } from "bun:test";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import { TerminalConfigSchema } from "@tokenring-ai/terminal/schema";
import TerminalService from "@tokenring-ai/terminal/TerminalService";
import fs from "fs-extra";
import PosixTerminalProvider from "../PosixTerminalProvider";
import { PosixTerminalProviderOptionsSchema } from "../schema";

/**
 * Integration tests for PosixTerminalProvider that test the complete flow
 * including command execution and edge cases.
 */
describe("PosixTerminalProvider Integration Tests", () => {
  const testDir = "/tmp/posix-terminal-test";
  let app: any;
  let terminalService: TerminalService;
  let service: PosixTerminalProvider;

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
    service = new PosixTerminalProvider(app, terminalService, PosixTerminalProviderOptionsSchema.parse({ sandboxProvider: "auto" }));
  });

  describe("Shell Commands", () => {
    it("should run shell commands", async () => {
      // Simple command test
      const result = await service.runScript("echo hello", { timeoutSeconds: 5, workingDirectory: testDir, isolation: "none" });
      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.output).toBe("hello");
      }
    });

    it("should handle command errors gracefully", async () => {
      // Command that should fail
      const result = await service.runScript("false", { timeoutSeconds: 5, workingDirectory: testDir, isolation: "none" });
      expect(result.status).toBe("badExitCode");
      if (result.status === "badExitCode") {
        expect(result.exitCode).toBe(1);
      }
    });

    it("should handle command execution with executeCommand", async () => {
      const result = await service.executeCommand("echo", ["test"], { timeoutSeconds: 5, workingDirectory: testDir, isolation: "none" });
      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.output).toBe("test");
      }
    });

    it("should return partial output when a command times out", async () => {
      const result = await service.runScript("echo before-timeout; sleep 2; echo after-timeout", {
        timeoutSeconds: 1,
        workingDirectory: testDir,
        isolation: "none",
      });

      expect(result.status).toBe("timeout");
      if (result.status === "timeout") {
        expect(result.output).toBe("before-timeout");
      }
    }, 15000);

    it("should return partial output when executeCommand times out", async () => {
      const result = await service.executeCommand("bash", ["-c", "echo partial; sleep 2"], {
        timeoutSeconds: 1,
        workingDirectory: testDir,
        isolation: "none",
      });

      expect(result.status).toBe("timeout");
      if (result.status === "timeout") {
        expect(result.output).toBe("partial");
      }
    }, 15000);
  });
});
