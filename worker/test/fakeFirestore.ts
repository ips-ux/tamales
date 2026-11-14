// A Firestore REST API in memory, for tests. It answers the calls that worker/src/firestore.ts makes.
// The real `Firestore` client runs on top of it, so the tests also check the request shapes.

import { Firestore } from "../src/firestore";
import { decodeFields, encodeFields, type FirestoreFields } from "../src/firestoreValues";

const ROOT = "projects/demo/databases/(default)/documents";
const BASE = `https://firestore.googleapis.com/v1/${ROOT}`;

interface Write {
  update?: { name: string; fields?: FirestoreFields };
  updateMask?: { fieldPaths: string[] };
  delete?: string;
}

export interface FakeCall {
  method: string;
  url: string;
  body: unknown;
}

export function fakeFirestore(seed: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(structuredClone(seed)));
  const calls: FakeCall[] = [];
  const state = { abortCommits: 0, transactions: 0 };

  function merge(path: string, fields: FirestoreFields | undefined, mask: string[] | undefined) {
    const data = decodeFields(fields);
    if (!mask?.length) {
      docs.set(path, data);
      return;
    }
    const next = { ...(docs.get(path) ?? {}) };
    for (const field of mask) {
      if (field in data) next[field] = data[field];
      else delete next[field];
    }
    docs.set(path, next);
  }

  const fetchFn = (async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body as string) : null;
    calls.push({ method, url: input, body });
    const url = new URL(input);
    const full = decodeURIComponent(url.origin + url.pathname);
    if (!full.startsWith(BASE)) return new Response("unknown host", { status: 500 });
    const rest = full.slice(BASE.length);

    if (rest === ":beginTransaction") {
      state.transactions += 1;
      return Response.json({ transaction: `tx-${state.transactions}` });
    }
    if (rest === ":rollback") return Response.json({});
    if (rest === ":commit") {
      if (state.abortCommits > 0) {
        state.abortCommits -= 1;
        return Response.json({ error: { code: 409, status: "ABORTED" } }, { status: 409 });
      }
      for (const write of (body.writes ?? []) as Write[]) {
        if (write.delete) docs.delete(write.delete.slice(ROOT.length + 1));
        if (write.update) merge(write.update.name.slice(ROOT.length + 1), write.update.fields, write.updateMask?.fieldPaths);
      }
      return Response.json({ writeResults: [] });
    }

    const path = rest.replace(/^\//, "");
    const isDocument = path.split("/").length % 2 === 0;
    if (method === "GET" && !isDocument) {
      const documents = [...docs.entries()]
        .filter(([key]) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
        .map(([key, data]) => ({ name: `${ROOT}/${key}`, fields: encodeFields(data) }));
      return Response.json({ documents });
    }
    if (method === "GET") {
      const data = docs.get(path);
      if (!data) return new Response("{}", { status: 404 });
      return Response.json({ name: `${ROOT}/${path}`, fields: encodeFields(data) });
    }
    if (method === "PATCH") {
      if (url.searchParams.get("currentDocument.exists") === "true" && !docs.has(path)) {
        return new Response("{}", { status: 404 });
      }
      merge(path, body.fields, url.searchParams.getAll("updateMask.fieldPaths"));
      return Response.json({});
    }
    if (method === "DELETE") {
      docs.delete(path);
      return Response.json({});
    }
    return new Response("not handled", { status: 500 });
  }) as unknown as typeof fetch;

  const db = new Firestore("demo", async () => "token", fetchFn);
  /** All documents of 1 collection. */
  const all = (collection: string) =>
    [...docs.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([, data]) => data);
  return { db, docs, calls, state, all, base: BASE, root: ROOT };
}

/** Collects the email that the Worker sends through Resend. */
export function fakeMailer() {
  const sent: Array<{ to: string[]; subject: string; html: string; text: string; reply_to?: string }> = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string));
    return Response.json({ id: "email" });
  }) as unknown as typeof fetch;
  return { mailer: { apiKey: "key", from: "Test <test@example.com>", fetchFn }, sent };
}

/** Collects deferred work, so a test can wait for the email. */
export function fakeDefer() {
  const work: Promise<unknown>[] = [];
  return { defer: (promise: Promise<unknown>) => void work.push(promise), done: () => Promise.all(work) };
}
