import { Mail, MailOpen, Phone, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  deleteContactMessage,
  setContactMessageRead,
  watchContactMessages,
  type ContactMessageRecord
} from "../../lib/firestoreClient";
import { formatBusinessDateTime } from "../../lib/time";
import { contactDisplayName, contactPhoneHref, contactReplyHref } from "./contactLinks";

/** Admin > Contacts: messages from the public Contact form, newest first. */
export function ContactMessagesCard() {
  const [messages, setMessages] = useState<ContactMessageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  useEffect(
    () =>
      watchContactMessages(
        (data) => {
          setMessages(data);
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

  async function run(id: string, action: () => Promise<void>, failure: string) {
    setBusyId(id);
    setActionError("");
    try {
      await action();
      setConfirmDeleteId(null);
    } catch {
      setActionError(failure);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <article className="admin-card">
      <h2>Messages</h2>
      {loading && <p className="muted">Loading messages.</p>}
      {loadFailed && (
        <p className="form-notice form-notice-error" role="alert">
          We could not load the messages. Check your connection, then reload the page.
        </p>
      )}
      {!loading && !loadFailed && messages.length === 0 && <p className="muted">No messages.</p>}
      {actionError && (
        <p className="form-notice form-notice-error" role="alert">
          {actionError}
        </p>
      )}
      {messages.map((message) => {
        const name = contactDisplayName(message.firstName, message.lastName);
        const phoneHref = contactPhoneHref(message.phone);
        const busy = busyId === message.id;
        return (
          <article className="message-row" key={message.id}>
            <div className="message-row-head">
              <strong>{name}</strong>
              {!message.read && <span className="status-badge status-new">New</span>}
              <small>{formatBusinessDateTime(message.createdAtUtc)}</small>
            </div>
            <div className="message-row-links">
              <a href={contactReplyHref(message.email)}>
                <Mail size={16} aria-hidden="true" />
                {message.email}
              </a>
              {phoneHref && (
                <a href={phoneHref}>
                  <Phone size={16} aria-hidden="true" />
                  {message.phone}
                </a>
              )}
            </div>
            <p className="message-row-text">{message.message}</p>
            {confirmDeleteId === message.id ? (
              <div className="message-row-actions" role="group" aria-label={`Delete the message from ${name}`}>
                <span className="message-row-confirm">Delete this message?</span>
                <button
                  className="button button-small"
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDeleteId(null)}
                >
                  Keep Message
                </button>
                <button
                  className="button button-small message-row-delete"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      message.id,
                      () => deleteContactMessage(message.id),
                      "We could not delete the message. Check your connection, then try again."
                    )
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {busy ? "Deleting..." : "Delete Message"}
                </button>
              </div>
            ) : (
              <div className="message-row-actions">
                <button
                  className="button button-small"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      message.id,
                      () => setContactMessageRead(message.id, !message.read),
                      "We could not change the message. Check your connection, then try again."
                    )
                  }
                >
                  <MailOpen size={16} aria-hidden="true" />
                  {message.read ? "Mark as Unread" : "Mark as Read"}
                </button>
                <button
                  className="button button-small"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setActionError("");
                    setConfirmDeleteId(message.id);
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
