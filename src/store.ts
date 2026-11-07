import {
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
  constants,
} from "node:fs";
import { join } from "node:path";
import { Commit, Engine, Persistence } from "./engine.js";
import { canonical, exact, hash, need, parseJSON, Fault } from "./core.js";

// Synchronous single-writer fsynced journal. The journal is the source of replay;
// no mutable snapshot is trusted. A complete corrupt record fails closed.
export class Journal implements Persistence {
  private fd = -1;
  private lock: string;
  private previous: string;
  private closed = false;
  constructor(
    private dir: string,
    engine: Engine,
  ) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    need(
      lstatSync(dir).isDirectory() && !lstatSync(dir).isSymbolicLink(),
      "STORAGE_PATH",
    );
    this.lock = join(dir, "writer.lock.local");
    this.previous = hash("journal-genesis/v1", engine.policyHash);
    let lockFd: number;
    try {
      lockFd = openSync(this.lock, "wx", 0o600);
    } catch {
      throw new Fault("WRITER_LOCKED");
    }
    try {
      try {
        writeSync(lockFd, String(process.pid) + "\n");
        fsyncSync(lockFd);
      } finally {
        closeSync(lockFd);
      }
      const manifestPath = join(dir, "manifest.json");
      if (!existsSync(manifestPath)) {
        const mf = openSync(manifestPath, "wx", 0o600);
        try {
          writeSync(
            mf,
            canonical({
              format: "local-journal-v1",
              configHash: engine.policyHash,
            }),
          );
          fsyncSync(mf);
        } finally {
          closeSync(mf);
        }
      }
      const manifest = exact(parseJSON(readFileSync(manifestPath, "utf8")), [
        "format",
        "configHash",
      ]);
      need(
        manifest.format === "local-journal-v1" &&
          manifest.configHash === engine.policyHash,
        "MANIFEST_MISMATCH",
      );
      const path = join(dir, "events.jsonl");
      const created = !existsSync(path);
      this.fd = openSync(
        path,
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_APPEND |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      if (created && process.platform !== "win32") {
        const dfd = openSync(dir, "r");
        try {
          fsyncSync(dfd);
        } finally {
          closeSync(dfd);
        }
      }
      const bytes = readFileSync(this.fd);
      const end = bytes.lastIndexOf(10) + 1;
      // Only an unterminated tail is recoverable. An acknowledged record has newline + fsync.
      if (end < bytes.length) {
        const tfd = openSync(
          path,
          constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        try {
          ftruncateSync(tfd, end);
          fsyncSync(tfd);
        } finally {
          closeSync(tfd);
        }
      }
      for (const line of bytes
        .subarray(0, end)
        .toString("utf8")
        .split("\n")
        .filter(Boolean)) {
        const row = exact(parseJSON(line, 131072), [
          "previous",
          "commit",
          "checksum",
        ]);
        need(
          row.previous === this.previous &&
            row.checksum ===
              hash("journal-record/v1", [row.previous, row.commit]),
          "JOURNAL_CORRUPT",
        );
        exact(row.commit, ["packet", "time", "sequence", "stateHash"]);
        engine.replay(row.commit as Commit);
        this.previous = row.checksum;
      }
    } catch (e) {
      if (this.fd >= 0) closeSync(this.fd);
      unlinkSync(this.lock);
      throw e;
    }
  }
  append(commit: Commit): void {
    need(!this.closed, "STORAGE_CLOSED");
    const checksum = hash("journal-record/v1", [this.previous, commit]);
    const data = Buffer.from(
      canonical({ previous: this.previous, commit, checksum }) + "\n",
    );
    let offset = 0;
    while (offset < data.length)
      offset += writeSync(this.fd, data, offset, data.length - offset);
    fsyncSync(this.fd);
    this.previous = checksum;
  }
  close(): void {
    if (!this.closed) {
      closeSync(this.fd);
      unlinkSync(this.lock);
      this.closed = true;
    }
  }
}
export function attachJournal(engine: Engine, dir: string): Journal {
  try {
    const log = new Journal(dir, engine);
    engine.attach(log);
    return log;
  } catch (e) {
    engine.close();
    throw e;
  }
}
