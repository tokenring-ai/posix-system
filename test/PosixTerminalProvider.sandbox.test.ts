import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type TokenRingApp from "@tokenring-ai/app";
import { TerminalService } from "@tokenring-ai/terminal";
import { TerminalConfigSchema } from "@tokenring-ai/terminal/schema";
import PosixTerminalProvider from "../PosixTerminalProvider.ts";
import { PosixTerminalProviderOptionsSchema } from "../schema.ts";

/**
 * Sandbox write policy: every write-allowed path is writable, everything else
 * is not — not just the session cwd. Skipped where no sandbox provider exists.
 */
describe("PosixTerminalProvider sandbox write binds", () => {
  let cwdDir: string;
  let secondWritable: string;
  let outsideDir: string;
  let provider: PosixTerminalProvider;

  const app = {
    serviceOutput: () => {},
    serviceError: () => {},
  } as unknown as TokenRingApp;

  const terminalService = new TerminalService(TerminalConfigSchema.parse({ agentDefaults: { provider: "posix" } }), app);

  beforeAll(() => {
    cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbx-cwd-"));
    secondWritable = fs.mkdtempSync(path.join(os.tmpdir(), "sbx-second-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbx-outside-"));
    provider = new PosixTerminalProvider(app, terminalService, PosixTerminalProviderOptionsSchema.parse({ sandboxProvider: "auto" }));
  });

  afterAll(() => {
    for (const dir of [cwdDir, secondWritable, outsideDir]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function sandboxAvailable(): boolean {
    return provider.supportedIsolationLevels.includes("sandbox");
  }

  it("allows writes to a second writable path outside the cwd", async () => {
    if (!sandboxAvailable()) return;
    const target = path.join(secondWritable, "out.txt");
    const result = await provider.runScript(`echo hello > ${target}`, {
      timeoutSeconds: 10,
      workingDirectory: cwdDir,
      writablePaths: [cwdDir, secondWritable],
      readablePaths: [],
      isolation: "sandbox",
    });
    expect(result.status).toBe("success");
    expect(fs.readFileSync(target, "utf-8").trim()).toBe("hello");
  });

  it("blocks writes outside every writable path", async () => {
    if (!sandboxAvailable()) return;
    const target = path.join(outsideDir, "blocked.txt");
    const result = await provider.runScript(`echo nope > ${target}`, {
      timeoutSeconds: 10,
      workingDirectory: cwdDir,
      writablePaths: [cwdDir, secondWritable],
      readablePaths: [],
      isolation: "sandbox",
    });
    expect(result.status).toBe("badExitCode");
    expect(fs.existsSync(target)).toBe(false);
  });

  it("skips writable entries that do not exist instead of failing the spawn", async () => {
    if (!sandboxAvailable()) return;
    const result = await provider.runScript("echo still-works", {
      timeoutSeconds: 10,
      workingDirectory: cwdDir,
      writablePaths: [cwdDir, path.join(os.tmpdir(), "sbx-missing-does-not-exist")],
      readablePaths: [],
      isolation: "sandbox",
    });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.output).toBe("still-works");
    }
  });
});
