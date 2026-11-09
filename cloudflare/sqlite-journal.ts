import { Commit, Engine, Persistence } from "../src/engine.js";
import { canonical, exact, hash, need, parseJSON } from "../src/core.js";

// Same hash-chain and replay rules as the Node Journal, backed by SQLite transactions.
// No mutable snapshot is trusted; no async append is hidden behind the sync interface.
export class SQLiteJournal implements Persistence {
  private previous: string;
  private closed = false;
  constructor(private storage: DurableObjectStorage, engine: Engine) {
    this.previous = hash("journal-genesis/v1", engine.policyHash);
    for (const row of storage.sql.exec<{ sequence: number; record: string }>(
      "SELECT sequence, record FROM journal ORDER BY sequence ASC",
    )) {
      const record = exact(parseJSON(row.record, 131072), ["previous", "commit", "checksum"]);
      exact(record.commit, ["packet", "time", "sequence", "stateHash"]);
      need(row.sequence === record.commit.sequence && record.previous === this.previous &&
        record.checksum === hash("journal-record/v1", [record.previous, record.commit]), "JOURNAL_CORRUPT");
      engine.replay(record.commit as Commit);
      this.previous = record.checksum;
    }
  }
  append(commit: Commit): void {
    need(!this.closed, "STORAGE_CLOSED");
    const checksum = hash("journal-record/v1", [this.previous, commit]);
    const record = canonical({ previous: this.previous, commit, checksum });
    this.storage.transactionSync(() => {
      this.storage.sql.exec("INSERT INTO journal(sequence, record) VALUES (?, ?)", commit.sequence, record);
    });
    this.previous = checksum;
    // Output gates remain enabled. RPC cannot acknowledge unconfirmed writes.
  }
  close(): void { this.closed = true; }
}
