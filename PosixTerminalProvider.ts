import { setTimeout as delay } from "node:timers/promises";
import type TokenRingApp from "@tokenring-ai/app";
import type { TerminalService } from "@tokenring-ai/terminal";
import type {
  ExecuteCommandOptions,
  ExecuteCommandResult,
  InteractiveTerminalOptions,
  InteractiveTerminalOutput,
  InteractiveTerminalProvider,
  OutputWaitOptions,
  SessionStatus,
  TerminalIsolationLevel,
} from "@tokenring-ai/terminal/TerminalProvider";
import formatLogMessages from "@tokenring-ai/utility/string/formatLogMessage";
import { which } from "bun";
import type { PosixTerminalProviderOptions } from "./schema.ts";

const textDecoder = new TextDecoder();
const MAX_OUTPUT_BYTES = 1024 * 1024;

interface InteractiveTerminalSession {
  id: string;
  process: Bun.Subprocess;
  /** The attached pseudo-terminal, or undefined for sessions running on plain pipes. */
  terminal: Bun.Terminal | undefined;
  /** Writes to the child's stdin, whichever transport backs the session. */
  write: (data: string) => void;
  /** Releases the session's stdio (pty handle or stdin sink). */
  closeIO: () => void;
  outputBuffer: string;
  lastReadPosition: number;
  startTime: number;
  lastOutputTime: number;
  exitCode?: number | undefined;
}

/**
 * Drain a piped stdout/stderr stream into the session buffer.
 * Uses a streaming decoder so multi-byte characters split across chunk boundaries survive.
 */
async function pumpStream(stream: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      onText(decoder.decode(result.value, { stream: true }));
    }
  } catch {
    // stream closed out from under us when the process was killed
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

/**
 * Spawn a non-interactive command with timeout and combined stdout/stderr.
 * Uses a detached process group so timeout kills child processes (e.g. sleep in a shell script).
 */
async function spawnCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs: number;
  },
): Promise<{ exitCode: number; output: string; timedOut: boolean }> {
  let timedOut = false;
  let outputBytes = 0;

  const proc = Bun.spawn([command, ...args], {
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // New session/process group so we can kill the whole tree on timeout
    detached: true,
  });

  const killTree = () => {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      try {
        proc.kill("SIGKILL");
      } catch {
        // already dead
      }
    }
  };

  const timer =
    options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          killTree();
        }, options.timeoutMs)
      : undefined;

  const readStream = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        const value = result.value;
        outputBytes += value.byteLength;
        chunks.push(value);
        if (outputBytes > MAX_OUTPUT_BYTES) {
          killTree();
          break;
        }
      }
    } catch {
      // stream closed after kill
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
    if (chunks.length === 0) return "";
    const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return textDecoder.decode(merged);
  };

  try {
    // stdout/stderr are ReadableStreams because we requested "pipe"
    const [stdout, stderr, exitCode] = await Promise.all([
      readStream(proc.stdout as ReadableStream<Uint8Array>),
      readStream(proc.stderr as ReadableStream<Uint8Array>),
      proc.exited,
    ]);

    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    return {
      exitCode,
      output,
      timedOut,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default class PosixTerminalProvider implements InteractiveTerminalProvider {
  readonly isInteractive = true;
  readonly name = "PosixTerminalProvider";
  description = "Provides shell command execution on local system";
  supportedIsolationLevels: TerminalIsolationLevel[] = ["none"];
  displayName: string;
  private sessions = new Map<string, InteractiveTerminalSession>();
  private nextId = 1;
  private readonly sandboxProvider: "none" | "bubblewrap" | "sandbox-exec" = "none";

  constructor(
    readonly app: TokenRingApp,
    readonly terminalService: TerminalService,
    readonly options: PosixTerminalProviderOptions,
  ) {
    if (options.sandboxProvider === "bubblewrap") {
      if (which("bwrap")) {
        this.supportedIsolationLevels.push("sandbox");
        this.sandboxProvider = "bubblewrap";
      } else {
        throw new Error("bubblewrap was set as the sandbox provider, but is not installed");
      }
    }
    if (options.sandboxProvider === "sandbox-exec") {
      if (process.platform === "darwin" && which("sandbox-exec")) {
        this.supportedIsolationLevels.push("sandbox");
        this.sandboxProvider = "sandbox-exec";
      } else {
        throw new Error("sandbox-exec was set as the sandbox provider, but is not available (macOS only)");
      }
    }
    if (options.sandboxProvider === "auto") {
      if (which("bwrap")) {
        this.supportedIsolationLevels.push("sandbox");
        this.sandboxProvider = "bubblewrap";
      } else if (process.platform === "darwin" && which("sandbox-exec")) {
        this.supportedIsolationLevels.push("sandbox");
        this.sandboxProvider = "sandbox-exec";
      }
    }

    this.displayName = `PosixTerminalProvider (sandboxProvider: ${this.sandboxProvider})`;
  }

  async executeCommand(command: string, args: string[], options: ExecuteCommandOptions): Promise<ExecuteCommandResult> {
    const { timeoutSeconds, workingDirectory: cwd } = options;
    const wrapped = this.wrapWithIsolation(command, args, options);

    try {
      const result = await spawnCommand(wrapped.command, wrapped.args, {
        cwd,
        env: process.env,
        timeoutMs: timeoutSeconds * 1000,
      });

      if (result.timedOut) {
        return {
          status: "timeout",
          output: result.output,
        };
      }
      if (result.exitCode === 0) {
        return {
          status: "success",
          output: result.output,
          exitCode: 0,
        };
      }
      return {
        status: "badExitCode",
        output: result.output,
        exitCode: result.exitCode,
      };
    } catch (err) {
      return {
        status: "unknownError",
        error: formatLogMessages([err as Error]),
      };
    }
  }

  async runScript(script: string, options: ExecuteCommandOptions): Promise<ExecuteCommandResult> {
    const { timeoutSeconds, workingDirectory: cwd } = options;
    const shell = process.env.SHELL || "/bin/bash";
    const wrapped = this.wrapWithIsolation(shell, ["-c", script], options);

    this.app.serviceOutput(this.terminalService, "[runScript]", "spawning shell:", wrapped.command, " ", wrapped.args.join(" "), "in:", cwd);

    try {
      const result = await spawnCommand(wrapped.command, wrapped.args, {
        cwd,
        env: {
          ...process.env,
          TERM: "dumb",
          NO_COLOR: "1",
        },
        timeoutMs: timeoutSeconds * 1000,
      });

      if (result.timedOut) {
        return {
          status: "timeout",
          output: result.output,
        };
      }
      if (result.exitCode === 0) {
        return {
          status: "success",
          output: result.output,
          exitCode: 0,
        };
      }
      return {
        status: "badExitCode",
        output: result.output,
        exitCode: result.exitCode,
      };
    } catch (err) {
      return {
        status: "unknownError",
        error: formatLogMessages([err as Error]),
      };
    }
  }

  async startInteractiveSession(options: InteractiveTerminalOptions): Promise<string> {
    const id = `term-${this.nextId++}`;
    const cwd = options.workingDirectory;
    const usePty = options.pty ?? this.options.interactiveMode === "pty";

    const shell = process.env.SHELL || "/bin/bash";
    const wrapped = this.wrapWithIsolation(shell, [], options);

    this.app.serviceOutput(
      this.terminalService,
      "[startInteractiveSession]",
      id,
      `spawning shell (${usePty ? "pty" : "pipe"}):`,
      wrapped.command,
      "args: ",
      wrapped.args.join(" "),
      "in:",
      cwd,
    );

    // Create session first so the output callbacks can append to it
    const session: InteractiveTerminalSession = {
      id,
      // placeholders assigned after spawn
      process: null as unknown as Bun.Subprocess,
      terminal: undefined,
      write: () => {
        throw new Error(`Session ${id} is not ready`);
      },
      closeIO: () => {},
      outputBuffer: "",
      lastReadPosition: 0,
      startTime: Date.now(),
      lastOutputTime: Date.now(),
    };

    const appendOutput = (text: string) => {
      session.outputBuffer += text;
      session.lastOutputTime = Date.now();
    };

    const onExit = (_subprocess: Bun.Subprocess, exitCode: number | null) => {
      // exitCode is null when killed by signal; mark complete either way
      session.exitCode = exitCode ?? 0;
    };

    if (usePty) {
      const ptyDecoder = new TextDecoder();
      const proc = Bun.spawn([wrapped.command, ...wrapped.args], {
        cwd,
        env: {
          ...process.env,
          TERM: this.options.terminalType,
        },
        terminal: {
          cols: options.cols ?? this.options.cols,
          rows: options.rows ?? this.options.rows,
          name: this.options.terminalType,
          data(_terminal, data) {
            appendOutput(ptyDecoder.decode(data, { stream: true }));
          },
        },
        onExit,
      });

      const terminal = proc.terminal;
      if (!terminal) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
        throw new Error("Bun.spawn failed to attach a terminal for interactive session");
      }

      session.process = proc;
      session.terminal = terminal;
      session.write = data => {
        terminal.write(data);
      };
      session.closeIO = () => {
        if (!terminal.closed) terminal.close();
      };
    } else {
      const proc = Bun.spawn([wrapped.command, ...wrapped.args], {
        cwd,
        env: {
          ...process.env,
          TERM: "dumb",
          NO_COLOR: "1",
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        onExit,
      });

      const { stdin, stdout, stderr } = proc;
      if (!stdin || typeof stdin === "number" || !(stdout instanceof ReadableStream) || !(stderr instanceof ReadableStream)) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
        throw new Error("Bun.spawn failed to attach pipes for interactive session");
      }

      session.process = proc;
      session.write = data => {
        // FileSink buffers; flush pushes the line to the child now rather than at some later fill.
        void stdin.write(data);
        void stdin.flush();
      };
      session.closeIO = () => {
        try {
          void stdin.end();
        } catch {
          // already closed
        }
      };

      // Both streams land in one buffer, matching how a pty interleaves them.
      void pumpStream(stdout, appendOutput);
      void pumpStream(stderr, appendOutput);
    }

    this.sessions.set(id, session);

    // Wait briefly for initial prompt to appear
    await delay(100);

    return id;
  }

  sendInput(sessionId: string, input: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    // Callers are split: the tools send bare commands, the web UI sends its own newline.
    // Terminate the line here only when the caller has not already done so.
    session.write(input.endsWith("\n") ? input : `${input}\n`);
  }

  /**
   * Tell the shell its window changed size. No-op for pipe-mode sessions, which have no
   * window for the child to query.
   */
  resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (!session.terminal || session.terminal.closed) return;
    session.terminal.resize(cols, rows);
  }

  collectOutput(sessionId: string, fromPosition: number, _waitOptions: OutputWaitOptions): InteractiveTerminalOutput {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const output = session.outputBuffer.substring(fromPosition);
    const newPosition = session.outputBuffer.length;
    const isComplete = session.exitCode !== undefined;

    return {
      output,
      newPosition,
      isComplete,
      exitCode: session.exitCode,
    };
  }

  terminateSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.app.serviceOutput(this.terminalService, `[terminateSession] Terminating session ${sessionId}`);
    try {
      session.process.kill();
    } catch {
      // already exited
    }
    try {
      session.closeIO();
    } catch {
      // already closed
    }
    this.sessions.delete(sessionId);
  }

  getSessionStatus(sessionId: string): SessionStatus | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: session.id,
      running: session.exitCode === undefined,
      startTime: session.startTime,
      outputLength: session.outputBuffer.length,
      exitCode: session.exitCode,
    };
  }

  private wrapWithIsolation(
    command: string,
    args: string[],
    options: { workingDirectory: string; isolation: TerminalIsolationLevel },
  ): { command: string; args: string[] } {
    const isolationLevel = options.isolation;
    if (isolationLevel === "none") {
      return { command: command, args };
    }

    const cwd = options.workingDirectory;

    if (this.sandboxProvider === "sandbox-exec") {
      return this.wrapWithSandboxExec(command, args, cwd);
    }

    return this.wrapWithBubbleWrap(command, args, cwd);
  }

  private wrapWithBubbleWrap(command: string, args: string[], cwd: string) {
    const homeDir = process.env.HOME || "/home/" + process.env.USER;
    const bwrapArgs = [
      "--ro-bind",
      "/etc",
      "/etc",
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--ro-bind",
      "/bin",
      "/bin",
      "--ro-bind",
      "/sbin",
      "/sbin",
      "--ro-bind",
      "/etc",
      "/etc",
      "--ro-bind",
      homeDir,
      homeDir,
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--bind",
      cwd,
      cwd,
      "--chdir",
      cwd,
      "--unshare-all",
      "--share-net",
      "--die-with-parent",
      command,
      ...args,
    ];

    return { command: "bwrap", args: bwrapArgs };
  }

  private wrapWithSandboxExec(command: string, args: string[], cwd: string): { command: string; args: string[] } {
    const tmpDir = process.env.TMPDIR || "/tmp";

    // Escape a path for inclusion in a Lisp-like sandbox profile string literal.
    const esc = (p: string) => p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    // Deny-by-default profile: allow reads everywhere, restrict writes to the
    // working directory and temp dirs, and deny outbound network access.
    const profile = [
      "(version 1)",
      "(allow default)",
      "(deny file-write*)",
      `(allow file-write* (subpath "${esc(cwd)}"))`,
      `(allow file-write* (subpath "${esc(tmpDir)}"))`,
      '(allow file-write* (subpath "/dev"))',
      '(allow file-write* (subpath "/private/tmp"))',
      '(allow file-write* (subpath "/private/var/tmp"))',
    ].join(" ");

    return {
      command: "sandbox-exec",
      args: ["-p", profile, command, ...args],
    };
  }
}
