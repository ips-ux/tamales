// Small Firestore client on the REST API. The service account is not subject to the security rules.

import { decodeFields, encodeFields, type FirestoreFields } from "./firestoreValues";

interface RestDocument {
  name: string;
  fields?: FirestoreFields;
}

export interface StoredDoc {
  id: string;
  data: Record<string, unknown>;
}

/** Firestore stopped the transaction because a second writer changed the same data. */
export class ContentionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentionError";
  }
}

/** Reads and writes inside 1 transaction. Firestore applies the writes together at the commit. */
export class Transaction {
  /** `Write` objects of the REST API, in order. */
  readonly writes: Record<string, unknown>[] = [];

  constructor(
    private db: Firestore,
    readonly id: string
  ) {}

  /** Reads 1 document in the transaction. Do all reads before the first write. */
  get(path: string): Promise<Record<string, unknown> | null> {
    return this.db.get(path, this.id);
  }

  /** Same as `Firestore.set`. The write occurs at the commit. */
  set(path: string, data: Record<string, unknown>, mergeFields?: string[]): void {
    const write: Record<string, unknown> = { update: { name: this.db.docName(path), fields: encodeFields(data) } };
    if (mergeFields?.length) write.updateMask = { fieldPaths: mergeFields };
    this.writes.push(write);
  }

  delete(path: string): void {
    this.writes.push({ delete: this.db.docName(path) });
  }
}

const MAX_TRANSACTION_ATTEMPTS = 5;

export class Firestore {
  private base: string;
  private root: string;

  constructor(
    projectId: string,
    private getToken: () => Promise<string>,
    // Wrap the global fetch. Calling it as `this.fetchFn(...)` would pass this
    // class as the receiver, and Workers then throw "Illegal invocation".
    private fetchFn: typeof fetch = (input, init) => fetch(input, init)
  ) {
    this.root = `projects/${projectId}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
  }

  /** The full resource name of a document, for the `Write` objects of a commit. */
  docName(path: string): string {
    return `${this.root}/${path}`;
  }

  private url(path: string): string {
    return `${this.base}/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    return this.fetchFn(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
  }

  /** Reads 1 document. Returns null if it does not exist. `transaction` is for `Transaction.get`. */
  async get(path: string, transaction?: string): Promise<Record<string, unknown> | null> {
    const suffix = transaction ? `?${new URLSearchParams({ transaction })}` : "";
    const response = await this.request(`${this.url(path)}${suffix}`);
    if (response.status === 404) return null;
    if (transaction && response.status === 409) {
      throw new ContentionError(`Firestore get ${path} aborted: ${await response.text()}`);
    }
    if (!response.ok) throw new Error(`Firestore get ${path} failed (${response.status}): ${await response.text()}`);
    return decodeFields(((await response.json()) as RestDocument).fields);
  }

  /** Reads all documents in a collection. */
  async list(collection: string): Promise<StoredDoc[]> {
    const docs: StoredDoc[] = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({ pageSize: "300" });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await this.request(`${this.url(collection)}?${query}`);
      if (!response.ok) {
        throw new Error(`Firestore list ${collection} failed (${response.status}): ${await response.text()}`);
      }
      const page = (await response.json()) as { documents?: RestDocument[]; nextPageToken?: string };
      for (const doc of page.documents ?? []) {
        docs.push({ id: decodeURIComponent(doc.name.split("/").pop() ?? ""), data: decodeFields(doc.fields) });
      }
      pageToken = page.nextPageToken ?? "";
    } while (pageToken);
    return docs;
  }

  /**
   * Writes 1 document. With `mergeFields`, it changes only those top-level
   * fields and keeps the others. Without it, it replaces the document.
   */
  async set(path: string, data: Record<string, unknown>, mergeFields?: string[]): Promise<void> {
    const query = new URLSearchParams();
    for (const field of mergeFields ?? []) query.append("updateMask.fieldPaths", field);
    const suffix = mergeFields?.length ? `?${query}` : "";
    const response = await this.request(`${this.url(path)}${suffix}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: encodeFields(data) })
    });
    if (!response.ok) throw new Error(`Firestore set ${path} failed (${response.status}): ${await response.text()}`);
  }

  /**
   * Changes only the given top-level fields of a document that exists.
   * Throws if the document does not exist.
   */
  async update(path: string, data: Record<string, unknown>): Promise<void> {
    const query = new URLSearchParams({ "currentDocument.exists": "true" });
    for (const field of Object.keys(data)) query.append("updateMask.fieldPaths", field);
    const response = await this.request(`${this.url(path)}?${query}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: encodeFields(data) })
    });
    if (!response.ok) throw new Error(`Firestore update ${path} failed (${response.status}): ${await response.text()}`);
  }

  /** Deletes 1 document. It does not fail if the document does not exist. */
  async delete(path: string): Promise<void> {
    const response = await this.request(this.url(path), { method: "DELETE" });
    if (!response.ok) throw new Error(`Firestore delete ${path} failed (${response.status}): ${await response.text()}`);
  }

  private async beginTransaction(retryTransaction: string): Promise<string> {
    const readWrite = retryTransaction ? { retryTransaction } : {};
    const response = await this.request(`${this.base}:beginTransaction`, {
      method: "POST",
      body: JSON.stringify({ options: { readWrite } })
    });
    if (!response.ok) {
      throw new Error(`Firestore beginTransaction failed (${response.status}): ${await response.text()}`);
    }
    const id = ((await response.json()) as { transaction?: string }).transaction;
    if (!id) throw new Error("Firestore beginTransaction returned no transaction id.");
    return id;
  }

  private async commit(writes: Record<string, unknown>[], transaction: string): Promise<void> {
    const response = await this.request(`${this.base}:commit`, {
      method: "POST",
      body: JSON.stringify({ writes, transaction })
    });
    if (response.status === 409) throw new ContentionError(`Firestore commit aborted: ${await response.text()}`);
    if (!response.ok) throw new Error(`Firestore commit failed (${response.status}): ${await response.text()}`);
  }

  private async rollback(transaction: string): Promise<void> {
    try {
      const response = await this.request(`${this.base}:rollback`, {
        method: "POST",
        body: JSON.stringify({ transaction })
      });
      if (!response.ok) console.error(`Firestore rollback failed (${response.status}): ${await response.text()}`);
    } catch (error) {
      console.error("Firestore rollback failed", error);
    }
  }

  /**
   * Runs `work` in a read-write transaction. If a second writer changes the same
   * data, Firestore aborts and this function runs `work` again, 5 times at most.
   * `work` must have no effect outside the transaction, because it can run again.
   */
  async runTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    let previous = "";
    for (let attempt = 1; ; attempt += 1) {
      const id = await this.beginTransaction(previous);
      const tx = new Transaction(this, id);
      try {
        const result = await work(tx);
        await this.commit(tx.writes, id);
        return result;
      } catch (error) {
        if (!(error instanceof ContentionError)) {
          await this.rollback(id);
          throw error;
        }
        if (attempt >= MAX_TRANSACTION_ATTEMPTS) throw error;
        console.warn(`Firestore transaction attempt ${attempt} aborted. Trying again.`);
        previous = id;
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 30));
      }
    }
  }
}
