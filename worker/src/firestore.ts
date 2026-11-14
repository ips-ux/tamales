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

export class Firestore {
  private base: string;

  constructor(
    projectId: string,
    private getToken: () => Promise<string>,
    private fetchFn: typeof fetch = fetch
  ) {
    this.base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
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

  /** Reads 1 document. Returns null if it does not exist. */
  async get(path: string): Promise<Record<string, unknown> | null> {
    const response = await this.request(this.url(path));
    if (response.status === 404) return null;
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
}
