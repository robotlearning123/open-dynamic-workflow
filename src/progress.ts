import type { ProgressEvent, ProgressReporter } from "./types.js";

export class TreeReporter implements ProgressReporter {
  private readonly stream: NodeJS.WritableStream;

  constructor(o?: { stream?: NodeJS.WritableStream }) {
    this.stream = o?.stream ?? process.stderr;
  }

  emit(e: ProgressEvent): void {
    switch (e.kind) {
      case "phase":
        this.stream.write(`\n[phase] ${e.title}\n`);
        break;

      case "log":
        this.stream.write(`  >> ${e.message}\n`);
        break;

      case "agent-start": {
        const cached = e.cached ? " (cached)" : "";
        this.stream.write(
          `  [${e.phase}] #${e.ordinal} ${e.agentId} "${e.label}"${cached} starting...\n`
        );
        break;
      }

      case "agent-done": {
        const cached = e.cached ? " cached" : "";
        this.stream.write(
          `  [${e.phase}] #${e.ordinal} ${e.agentId} "${e.label}"${cached} done (${e.outputTokens} tokens)\n`
        );
        break;
      }

      case "agent-fail":
        this.stream.write(
          `  [${e.phase}] #${e.ordinal} ${e.agentId} "${e.label}" FAILED: ${e.error}\n`
        );
        break;
    }
  }
}

export const silentReporter: ProgressReporter = {
  emit(_e: ProgressEvent): void {
    // intentionally silent
  },
};
