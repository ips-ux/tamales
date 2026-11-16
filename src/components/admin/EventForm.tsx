import { FormEvent, useEffect, useState } from "react";
import type { EventRecord, KioskTarget, PreorderMode } from "../../../shared/model";
import { useBusinessSettings } from "../../lib/businessSettings";
import { fetchEventPrivate, newEventId, saveEvent } from "../../lib/eventsStore";
import type { MenuProduct } from "../../lib/types";
import {
  buildEventFields,
  emptyEventForm,
  eventToFormValues,
  hashExitPin,
  isValidExitPin,
  kioskTargetLabels,
  newKioskToken,
  preorderModeLabels,
  toggleId,
  type EventFormValues
} from "./eventRules";

interface EventFormProps {
  /** The event to edit. Absent for a new event. */
  event?: EventRecord;
  products: MenuProduct[];
  onSaved: (eventId: string) => void;
  onCancel: () => void;
}

const preorderModes: PreorderMode[] = ["off", "fixed", "open"];
const kioskTargets: KioskTarget[] = ["today", "next_batch"];

/** Admin > Events: add or edit 1 event. */
export function EventForm({ event, products, onSaved, onCancel }: EventFormProps) {
  const { timezone } = useBusinessSettings();
  const [values, setValues] = useState<EventFormValues>(() =>
    event ? eventToFormValues(event, timezone) : emptyEventForm()
  );
  const [address, setAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [privateLoaded, setPrivateLoaded] = useState(!event);
  const [pin, setPin] = useState("");
  const [changingPin, setChangingPin] = useState(!event?.exitPinHash);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const eventId = event?.id;
  useEffect(() => {
    if (!eventId) return;
    let active = true;
    fetchEventPrivate(eventId)
      .then((data) => {
        if (!active) return;
        setAddress(data.address);
        setInstructions(data.instructions);
        setPrivateLoaded(true);
      })
      .catch(() => {
        if (active) setErrors(["We could not load the exact address. Check your connection, then open the event again."]);
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  // The menu items that the form lists. An item that is not active stays in the list if the event has it.
  const menuItems = products.filter(
    (product) => product.status !== "inactive" || values.itemIds.includes(product.id)
  );
  const offered = values.itemIds.length > 0 ? menuItems.filter((item) => values.itemIds.includes(item.id)) : menuItems;

  function set<K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    const result = buildEventFields(
      values,
      menuItems.map((item) => item.id),
      timezone
    );
    const problems = [...result.errors];
    const newPin = changingPin ? pin.trim() : "";
    if (newPin && !isValidExitPin(newPin)) problems.push("Enter an exit PIN of 4 to 6 digits.");
    setErrors(problems);
    if (problems.length > 0 || !result.fields) return;

    setSaving(true);
    try {
      const id = event?.id ?? newEventId();
      const record: EventRecord = {
        ...result.fields,
        id,
        soldOutItemIds: event?.soldOutItemIds ?? [],
        liveOrdersPaused: event?.liveOrdersPaused ?? false,
        kioskToken: event?.kioskToken || newKioskToken(),
        exitPinHash: newPin ? await hashExitPin(id, newPin) : event?.exitPinHash ?? ""
      };
      await saveEvent(record, { address: address.trim(), instructions: instructions.trim() });
      onSaved(id);
    } catch {
      setErrors(["We could not save the event. Check your connection, then try again."]);
      setSaving(false);
    }
  }

  return (
    <form className="admin-card event-form" onSubmit={handleSubmit} noValidate>
      <h2>{event ? `Edit ${event.name}` : "Add an Event"}</h2>
      {errors.length > 0 && (
        <div className="error-summary" role="alert">
          <ul>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="form-grid">
        <label className="full-span">
          Event name
          <input value={values.name} autoComplete="off" onChange={(input) => set("name", input.target.value)} />
        </label>
        <label className="full-span">
          Area name
          <input
            value={values.areaName}
            autoComplete="off"
            onChange={(input) => set("areaName", input.target.value)}
          />
          <span className="field-help">Customers see this. Do not enter the exact address.</span>
        </label>
        <label className="full-span">
          Exact address
          <input
            value={address}
            autoComplete="off"
            disabled={!privateLoaded}
            onChange={(input) => setAddress(input.target.value)}
          />
          <span className="field-help">The customer gets this address only after payment.</span>
        </label>
        <label className="full-span">
          Pickup instructions
          <textarea
            rows={2}
            value={instructions}
            disabled={!privateLoaded}
            onChange={(input) => setInstructions(input.target.value)}
          />
        </label>
        <label>
          Start
          <input
            type="datetime-local"
            value={values.starts}
            onChange={(input) => set("starts", input.target.value)}
          />
        </label>
        <label>
          End
          <input type="datetime-local" value={values.ends} onChange={(input) => set("ends", input.target.value)} />
        </label>
        <label className="toggle-row full-span">
          <input type="checkbox" checked={values.active} onChange={(input) => set("active", input.target.checked)} />
          <span>Show this event on the site</span>
        </label>

        <fieldset className="event-form-group full-span">
          <legend>Menu items</legend>
          <span className="field-help">Select no menu items to offer all of them.</span>
          {menuItems.map((item) => (
            <label className="toggle-row" key={item.id}>
              <input
                type="checkbox"
                checked={values.itemIds.includes(item.id)}
                onChange={(input) => set("itemIds", toggleId(values.itemIds, item.id, input.target.checked))}
              />
              <span>{item.name}</span>
            </label>
          ))}
        </fieldset>

        <label>
          Pre-orders
          <select
            value={values.preorderMode}
            onChange={(input) => set("preorderMode", input.target.value as PreorderMode)}
          >
            {preorderModes.map((mode) => (
              <option key={mode} value={mode}>
                {preorderModeLabels[mode]}
              </option>
            ))}
          </select>
        </label>
        {values.preorderMode !== "off" && (
          <label>
            Pre-order cutoff
            <input
              type="datetime-local"
              value={values.cutoff}
              onChange={(input) => set("cutoff", input.target.value)}
            />
          </label>
        )}
        {values.preorderMode === "fixed" && (
          <fieldset className="event-form-group full-span">
            <legend>Allotment, in tamales</legend>
            {offered.map((item) => (
              <label className="event-form-allotment" key={item.id}>
                <span>{item.name}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={values.allotment[item.id] ?? ""}
                  onChange={(input) => set("allotment", { ...values.allotment, [item.id]: input.target.value })}
                />
              </label>
            ))}
          </fieldset>
        )}

        <label className="toggle-row full-span">
          <input
            type="checkbox"
            checked={values.liveOrdersEnabled}
            onChange={(input) => set("liveOrdersEnabled", input.target.checked)}
          />
          <span>Take orders from phones and the kiosk during event hours</span>
        </label>
        <label>
          Kiosk orders go to
          <select
            value={values.kioskTarget}
            onChange={(input) => set("kioskTarget", input.target.value as KioskTarget)}
          >
            {kioskTargets.map((target) => (
              <option key={target} value={target}>
                {kioskTargetLabels[target]}
              </option>
            ))}
          </select>
        </label>
        {changingPin ? (
          <label>
            Kiosk exit PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(input) => setPin(input.target.value)}
            />
            <span className="field-help">Use 4 to 6 digits.</span>
          </label>
        ) : (
          <div className="event-form-pin">
            <strong>Kiosk exit PIN</strong>
            <span>PIN is set</span>
            <button className="button button-small" type="button" onClick={() => setChangingPin(true)}>
              Change PIN
            </button>
          </div>
        )}
        <label className="toggle-row full-span">
          <input
            type="checkbox"
            checked={values.waitlistEnabled}
            onChange={(input) => set("waitlistEnabled", input.target.checked)}
          />
          <span>Show the waitlist on the kiosk</span>
        </label>

        <div className="button-row full-span">
          <button className="button button-ghost" type="button" onClick={onCancel} disabled={saving}>
            Back
          </button>
          <button className="button button-primary" type="submit" disabled={saving || !privateLoaded}>
            {saving ? "Saving..." : "Save Event"}
          </button>
        </div>
      </div>
    </form>
  );
}
