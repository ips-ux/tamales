import { Download, Mail, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { WaitlistEntry } from "../../../shared/model";
import { downloadCsv } from "../../lib/csv";
import { deleteWaitlistEntry, watchWaitlist } from "../../lib/eventsStore";
import { businessTodayKey, formatBusinessDateTime } from "../../lib/time";
import { contactDisplayName, waitlistCsv } from "./contactLinks";

/** Admin > Contacts: the waitlist, newest first. */
export function WaitlistCard() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  useEffect(
    () =>
      watchWaitlist(
        (data) => {
          setEntries(data);
          setLoading(false);
          setLoadFailed(false);
        },
        () => {
          setLoading(false);
          setLoadFailed(true);
        }
      ),
    []
  );

  async function remove(id: string) {
    setBusyId(id);
    setActionError("");
    try {
      await deleteWaitlistEntry(id);
      setConfirmDeleteId(null);
    } catch {
      setActionError("We could not delete the entry. Check your connection, then try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <article className="admin-card">
      <div className="toolbar">
        <h2>Waitlist</h2>
        <button
          className="button button-ghost"
          type="button"
          disabled={entries.length === 0}
          onClick={() =>
            downloadCsv(`bbt-waitlist-${businessTodayKey()}.csv`, waitlistCsv(entries, formatBusinessDateTime))
          }
        >
          <Download size={18} aria-hidden="true" />
          Download CSV
        </button>
      </div>
      {loading && <p className="muted">Loading the waitlist.</p>}
      {loadFailed && (
        <p className="form-notice form-notice-error" role="alert">
          We could not load the waitlist. Check your connection, then reload the page.
        </p>
      )}
      {!loading && !loadFailed && entries.length === 0 && <p className="muted">The waitlist is empty.</p>}
      {actionError && (
        <p className="form-notice form-notice-error" role="alert">
          {actionError}
        </p>
      )}
      {entries.map((entry) => {
        const name = contactDisplayName(entry.firstName, entry.lastName);
        const busy = busyId === entry.id;
        return (
          <article className="message-row" key={entry.id}>
            <div className="message-row-head">
              <strong>{name}</strong>
              {entry.eventName && <span className="muted">{entry.eventName}</span>}
              <small>{entry.createdAtUtc ? formatBusinessDateTime(entry.createdAtUtc) : ""}</small>
            </div>
            <div className="message-row-links">
              <a href={`mailto:${entry.email}`}>
                <Mail size={16} aria-hidden="true" />
                {entry.email}
              </a>
            </div>
            {entry.interest && <p className="message-row-text">{entry.interest}</p>}
            {confirmDeleteId === entry.id ? (
              <div className="message-row-actions" role="group" aria-label={`Delete the entry of ${name}`}>
                <span className="message-row-confirm">Delete this entry?</span>
                <button
                  className="button button-small"
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDeleteId(null)}
                >
                  Keep Entry
                </button>
                <button
                  className="button button-small message-row-delete"
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(entry.id)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {busy ? "Deleting..." : "Delete Entry"}
                </button>
              </div>
            ) : (
              <div className="message-row-actions">
                <button
                  className="button button-small"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setActionError("");
                    setConfirmDeleteId(entry.id);
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Delete
                </button>
              </div>
            )}
          </article>
        );
      })}
    </article>
  );
}
