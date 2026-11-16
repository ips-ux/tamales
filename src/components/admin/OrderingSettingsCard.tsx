import { Plus, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { orderingDefaults, type OrderingSettings } from "../../../shared/model";
import { fetchOrderingPrivate, saveOrderingSettings, watchOrderingSettings } from "../../lib/eventsStore";
import { buildRings, ringsToRows, type RingRow } from "./deliveryRings";
import {
  checkPaymentSettings,
  feeExample,
  paymentSettingsToForm,
  type PaymentSettingsForm
} from "./paymentSettings";

interface FormState extends PaymentSettingsForm {
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  pickupAreaName: string;
  pickupAddress: string;
  pickupInstructions: string;
  minBatchTamales: string;
  minNoticeDays: string;
  startAddress: string;
  rings: RingRow[];
  deliveryFeeTaxable: boolean;
}

function toForm(settings: OrderingSettings): FormState {
  return {
    pickupEnabled: settings.pickupEnabled,
    deliveryEnabled: settings.deliveryEnabled,
    pickupAreaName: settings.pickupAreaName,
    pickupAddress: "",
    pickupInstructions: "",
    minBatchTamales: String(settings.minBatchTamales),
    minNoticeDays: String(settings.minNoticeDays),
    startAddress: "",
    rings: ringsToRows(settings.deliveryRings),
    deliveryFeeTaxable: settings.deliveryFeeTaxable,
    ...paymentSettingsToForm(settings)
  };
}

function wholeNumber(text: string, minimum: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= minimum ? value : null;
}

/** Admin > Settings > Ordering: batch requests, pickup, delivery, and payment. */
export function OrderingSettingsCard() {
  const [form, setForm] = useState<FormState>(() => toForm(orderingDefaults));
  const [storedStartAddress, setStoredStartAddress] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load both documents 1 time. Later changes on screen belong to the owner.
  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    fetchOrderingPrivate()
      .then((privateSettings) => {
        if (!active) return;
        let first = true;
        unsubscribe = watchOrderingSettings(
          (settings) => {
            if (!first) return;
            first = false;
            setForm({
              ...toForm(settings),
              pickupAddress: privateSettings.pickupAddress,
              pickupInstructions: privateSettings.pickupInstructions,
              startAddress: privateSettings.startAddress
            });
            setStoredStartAddress(privateSettings.startAddress);
            setLoaded(true);
          },
          () => setLoadFailed(true)
        );
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setRing(index: number, change: Partial<RingRow>) {
    set(
      "rings",
      form.rings.map((row, position) => (position === index ? { ...row, ...change } : row))
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const problems: string[] = [];
    const minBatchTamales = wholeNumber(form.minBatchTamales, 1);
    const minNoticeDays = wholeNumber(form.minNoticeDays, 0);
    const payment = checkPaymentSettings(form);
    if (minBatchTamales === null) problems.push("Enter the minimum batch size as a whole number of 1 or more.");
    if (minNoticeDays === null) problems.push("Enter the days of notice as a whole number of 0 or more.");
    const rings = buildRings(form.rings);
    if (rings.error) problems.push(rings.error);
    const startAddress = form.startAddress.trim();
    if (form.deliveryEnabled && !startAddress) problems.push("Enter the delivery start address.");
    if (form.deliveryEnabled && !rings.error && rings.rings.length === 0) {
      problems.push("Add 1 delivery ring or more.");
    }
    problems.push(...payment.errors);
    setErrors(problems);
    setSaved(false);
    if (problems.length > 0 || minBatchTamales === null || minNoticeDays === null || payment.values === null) {
      return;
    }

    setSaving(true);
    try {
      await saveOrderingSettings(
        {
          pickupEnabled: form.pickupEnabled,
          deliveryEnabled: form.deliveryEnabled,
          pickupAreaName: form.pickupAreaName.trim(),
          minBatchTamales,
          minNoticeDays,
          deliveryRings: rings.rings,
          deliveryFeeTaxable: form.deliveryFeeTaxable,
          ...payment.values
        },
        {
          startAddress,
          pickupAddress: form.pickupAddress.trim(),
          pickupInstructions: form.pickupInstructions.trim()
        },
        startAddress !== storedStartAddress
      );
      setStoredStartAddress(startAddress);
      setForm((current) => ({ ...current, rings: ringsToRows(rings.rings) }));
      setSaved(true);
    } catch {
      setErrors(["We could not save the settings. Check your connection, then try again."]);
    } finally {
      setSaving(false);
    }
  }

  if (loadFailed) {
    return (
      <article className="admin-card settings-panel">
        <p className="form-notice form-notice-error" role="alert">
          We could not load the settings. Check your connection, then reload the page.
        </p>
      </article>
    );
  }
  if (!loaded) {
    return (
      <article className="admin-card settings-panel">
        <p className="muted">Loading settings.</p>
      </article>
    );
  }

  return (
    <form className="admin-card settings-list settings-panel ordering-settings" onSubmit={handleSubmit} noValidate>
      <h2>Ordering and Delivery</h2>
      {errors.length > 0 && (
        <div className="error-summary" role="alert">
          <ul>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.pickupEnabled}
          onChange={(input) => set("pickupEnabled", input.target.checked)}
        />
        <span>Offer pickup for batch requests</span>
      </label>
      <label>
        Pickup area name
        <input
          value={form.pickupAreaName}
          autoComplete="off"
          onChange={(input) => set("pickupAreaName", input.target.value)}
        />
        <span className="field-help">Customers see this. Do not enter the exact address.</span>
      </label>
      <label>
        Exact pickup address
        <input
          value={form.pickupAddress}
          autoComplete="off"
          onChange={(input) => set("pickupAddress", input.target.value)}
        />
        <span className="field-help">The customer gets this address only after payment.</span>
      </label>
      <label>
        Pickup instructions
        <textarea
          rows={2}
          value={form.pickupInstructions}
          onChange={(input) => set("pickupInstructions", input.target.value)}
        />
      </label>
      <label>
        Minimum batch size, in tamales
        <input
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={form.minBatchTamales}
          onChange={(input) => set("minBatchTamales", input.target.value)}
        />
      </label>
      <label>
        Minimum days of notice
        <input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={form.minNoticeDays}
          onChange={(input) => set("minNoticeDays", input.target.value)}
        />
      </label>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.deliveryEnabled}
          onChange={(input) => set("deliveryEnabled", input.target.checked)}
        />
        <span>Offer delivery for batch requests</span>
      </label>
      <label>
        Delivery start address
        <input
          value={form.startAddress}
          autoComplete="off"
          onChange={(input) => set("startAddress", input.target.value)}
        />
        <span className="field-help">Customers never see this address.</span>
      </label>
      <fieldset className="ring-editor">
        <legend>Delivery rings</legend>
        <span className="field-help">Each ring is a distance from the start address and a fee.</span>
        {form.rings.map((row, index) => (
          <div className="ring-row" key={index}>
            <label>
              Up to (miles)
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={row.miles}
                onChange={(input) => setRing(index, { miles: input.target.value })}
              />
            </label>
            <label>
              Fee ($)
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={row.fee}
                onChange={(input) => setRing(index, { fee: input.target.value })}
              />
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label={`Remove ring ${index + 1}`}
              onClick={() =>
                set(
                  "rings",
                  form.rings.filter((_, position) => position !== index)
                )
              }
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
        <button
          className="button button-small"
          type="button"
          onClick={() => set("rings", [...form.rings, { miles: "", fee: "" }])}
        >
          <Plus size={16} aria-hidden="true" />
          Add Ring
        </button>
      </fieldset>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.deliveryFeeTaxable}
          onChange={(input) => set("deliveryFeeTaxable", input.target.checked)}
        />
        <span>Charge tax on the delivery fee</span>
      </label>

      <fieldset className="ring-editor payment-settings">
        <legend>Payment</legend>
        <label>
          Hold time, in minutes
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={form.holdMinutes}
            onChange={(input) => set("holdMinutes", input.target.value)}
          />
          <span className="field-help">A pre-order with a fixed allotment holds its tamales for this time.</span>
        </label>
        <label>
          Payment time limit, in hours
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={form.paymentWindowHours}
            onChange={(input) => set("paymentWindowHours", input.target.value)}
          />
          <span className="field-help">An approved order that is not paid in this time expires.</span>
        </label>
        <label>
          PayPal fee (%)
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={form.paypalFeePercent}
            onChange={(input) => set("paypalFeePercent", input.target.value)}
          />
        </label>
        <label>
          PayPal fixed fee ($)
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={form.paypalFeeFixed}
            onChange={(input) => set("paypalFeeFixed", input.target.value)}
          />
        </label>
        <label>
          Customer share of the fee (%)
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            inputMode="numeric"
            value={form.feeSharePct}
            onChange={(input) => set("feeSharePct", input.target.value)}
          />
          <span className="field-help" aria-live="polite">
            {feeExample(form)}
          </span>
        </label>
      </fieldset>

      {saved && (
        <p className="form-notice" role="status">
          Saved.
        </p>
      )}
      <button className="button button-primary" type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save Settings"}
      </button>
    </form>
  );
}
