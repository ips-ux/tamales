import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrderState, TrackerRecord } from "../shared/model";
import {
  activeTrackerPath,
  activeTrackerToken,
  clearActiveTracker,
  parseResume,
  RESUME_MAX_AGE_MS,
  saveActiveTracker
} from "../src/components/tracker/resume";
import {
  cleanHandle,
  flashIsAlternate,
  flashPlan,
  isFinalTrackerState,
  isTrackerToken,
  itemText,
  mapTrackerDoc,
  moneyLines,
  paymentHelp,
  paymentLink,
  readyDetail,
  resumeAction,
  scheduledLabel,
  shouldAlert,
  statusAnnouncement,
  stepIndex,
  stepWord,
  trackerHeadline,
  trackerView,
  waitsForReady
} from "../src/components/tracker/trackerRules";

const TOKEN = "a".repeat(48);

function tracker(overrides: Partial<TrackerRecord> = {}): TrackerRecord {
  return {
    orderNumber: "#12 - Nov 14 - Jane Doe",
    kind: "live",
    state: "received",
    paymentState: "check_payment",
    paymentMethod: "venmo",
    paymentDescription: "#12 - Nov 14 - Jane Doe",
    firstName: "Jane",
    eventName: "Winter Market",
    fulfillment: "event_pickup",
    items: [{ label: "Red Tamales, Half dozen", quantity: 2 }],
    totals: { subtotalCents: 3600, deliveryFeeCents: 0, onlineFeeCents: 0, taxCents: 313, totalCents: 3913 },
    reason: "",
    scheduledAtUtc: "",
    updatedAtUtc: "2026-11-15T01:00:00.000Z",
    ...overrides
  };
}

const handles = { venmoHandle: "@Bangin-Bustos", cashAppCashtag: "$BanginBustos" };

describe("tracker document", () => {
  it("maps a stored document with a safe value for each field", () => {
    const record = mapTrackerDoc({
      state: "preparing",
      orderNumber: "BBT-1042",
      kind: "preorder",
      paymentState: "paid",
      paymentMethod: "bad",
      items: [{ label: "Red Tamales, Dozen", quantity: 1 }, null, "x"],
      totals: { subtotalCents: 3400, taxCents: "x" }
    });
    expect(record).toMatchObject({
      state: "preparing",
      orderNumber: "BBT-1042",
      kind: "preorder",
      paymentState: "paid",
      paymentMethod: "unset",
      fulfillment: "event_pickup",
      items: [{ label: "Red Tamales, Dozen", quantity: 1 }],
      totals: { subtotalCents: 3400, deliveryFeeCents: 0, onlineFeeCents: 0, taxCents: 0, totalCents: 0 },
      reason: ""
    });
  });

  it("returns null for a document with no valid state", () => {
    expect(mapTrackerDoc(undefined)).toBeNull();
    expect(mapTrackerDoc({ state: "new" })).toBeNull();
  });

  it("accepts only tokens with safe characters", () => {
    expect(isTrackerToken(TOKEN)).toBe(true);
    expect(isTrackerToken("short")).toBe(false);
    expect(isTrackerToken("abc/def/ghi")).toBe(false);
  });
});

describe("tracker steps and labels", () => {
  it("marks the step for each state, with a word", () => {
    expect(stepIndex("received")).toBe(0);
    expect(stepIndex("preparing")).toBe(1);
    expect(stepIndex("ready")).toBe(2);
    expect(stepIndex("requested")).toBe(-1);
    expect([0, 1, 2].map((index) => stepWord(index, 1))).toEqual(["Done", "Now", "Next"]);
  });

  it("shows the 3 steps for an accepted order", () => {
    const view = trackerView(tracker({ state: "preparing" }));
    expect(view).toEqual({ type: "steps", current: 1, ready: false });
    expect(trackerHeadline(view)).toBe("Being prepared");
    const ready = trackerView(tracker({ state: "ready" }));
    expect(trackerHeadline(ready)).toBe("Your order is ready!");
  });

  it("shows the pre-steps for a request", () => {
    expect(trackerHeadline(trackerView(tracker({ state: "requested" })))).toBe("Waiting for approval");
    const approved = trackerView(tracker({ state: "approved" }));
    expect(approved).toMatchObject({ label: "Approved. Pay to confirm.", detail: "We will send you a payment link." });
  });

  it("shows the label and the reason for a stopped order", () => {
    expect(trackerView(tracker({ state: "declined", reason: " No time. " }))).toMatchObject({
      label: "Declined",
      detail: "No time."
    });
    expect(trackerView(tracker({ state: "canceled", reason: "The event is off." }))).toMatchObject({
      label: "Canceled",
      detail: "The event is off."
    });
    expect(trackerView(tracker({ state: "expired" }))).toMatchObject({ label: "Canceled" });
  });

  it("thanks the customer at handover", () => {
    expect(trackerView(tracker({ state: "handed_over" }))).toMatchObject({ tone: "done", label: "Thanks, Jane!" });
    expect(trackerView(tracker({ state: "handed_over", firstName: "" }))).toMatchObject({ label: "Thanks!" });
  });

  it("says the status for the live region", () => {
    expect(statusAnnouncement(tracker({ state: "received" }))).toBe("Status: Received");
    expect(statusAnnouncement(tracker({ state: "ready" }))).toBe("Your order is ready!");
    expect(statusAnnouncement(tracker({ state: "declined", reason: "No time." }))).toBe("Declined No time.");
  });

  it("tells an event customer to come to the booth", () => {
    expect(readyDetail(tracker())).toBe("Come to the booth and show this page.");
    expect(readyDetail(tracker({ fulfillment: "pickup" }))).toBe("");
    expect(scheduledLabel("delivery")).toBe("Delivery");
    expect(scheduledLabel("pickup")).toBe("Pickup");
  });

  it("writes an item as label and quantity", () => {
    expect(itemText({ label: "Red Tamales, Half dozen", quantity: 2 })).toBe("Red Tamales, Half dozen × 2");
  });
});

describe("tracker money lines", () => {
  it("shows the lines in sequence and hides a fee of 0", () => {
    expect(moneyLines(tracker().totals).map((line) => line.label)).toEqual(["Subtotal", "Tax", "Total"]);
    const lines = moneyLines({
      subtotalCents: 6800,
      deliveryFeeCents: 500,
      onlineFeeCents: 120,
      taxCents: 592,
      totalCents: 8012
    });
    expect(lines.map((line) => line.label)).toEqual(["Subtotal", "Delivery fee", "Online ordering fee", "Tax", "Total"]);
    expect(lines.filter((line) => line.total).map((line) => line.cents)).toEqual([8012]);
  });
});

describe("payment help", () => {
  it("builds the Venmo link with the amount and the note", () => {
    expect(paymentLink("venmo", handles, 3913, "#12 - Nov 14 - Jane Doe")).toBe(
      "https://venmo.com/Bangin-Bustos?txn=pay&amount=39.13&note=%2312%20-%20Nov%2014%20-%20Jane%20Doe"
    );
  });

  it("builds the Cash App link with the amount and no note", () => {
    expect(paymentLink("cashapp", handles, 3900, "x")).toBe("https://cash.app/$BanginBustos/39.00");
  });

  it("gives no link with no account name or a bad account name, or for cash", () => {
    expect(paymentLink("venmo", { venmoHandle: "", cashAppCashtag: "" }, 100, "x")).toBe("");
    expect(paymentLink("venmo", { venmoHandle: "bad name/", cashAppCashtag: "" }, 100, "x")).toBe("");
    expect(paymentLink("cash", handles, 100, "x")).toBe("");
    expect(cleanHandle(" @@Jane_Doe ")).toBe("Jane_Doe");
  });

  it("shows the copy button and the link while the owner checks a link payment", () => {
    expect(paymentHelp(tracker(), handles)).toEqual({
      type: "link",
      buttonLabel: "Pay with Venmo",
      url: "https://venmo.com/Bangin-Bustos?txn=pay&amount=39.13&note=%2312%20-%20Nov%2014%20-%20Jane%20Doe",
      description: "#12 - Nov 14 - Jane Doe"
    });
    expect(paymentHelp(tracker({ paymentMethod: "cashapp" }), handles)).toMatchObject({
      buttonLabel: "Pay with Cash App",
      url: "https://cash.app/$BanginBustos/39.13"
    });
  });

  it("says pay at the booth for cash, and payment received when paid", () => {
    expect(paymentHelp(tracker({ paymentMethod: "cash" }), handles)).toEqual({ type: "text", text: "Pay at the booth." });
    expect(paymentHelp(tracker({ paymentState: "paid" }), handles)).toEqual({ type: "text", text: "Payment received." });
  });

  it("shows nothing for an unpaid pre-order or a stopped order", () => {
    expect(paymentHelp(tracker({ kind: "preorder", paymentState: "unpaid", paymentMethod: "unset" }), handles)).toEqual({
      type: "none"
    });
    expect(paymentHelp(tracker({ state: "canceled" }), handles)).toEqual({ type: "none" });
  });
});

describe("ready alert", () => {
  it("alerts only for a change to ready while the page is open", () => {
    expect(shouldAlert(null, "ready")).toBe(false);
    expect(shouldAlert("preparing", "ready")).toBe(true);
    expect(shouldAlert("received", "ready")).toBe(true);
    expect(shouldAlert("ready", "ready")).toBe(false);
    expect(shouldAlert("received", "preparing")).toBe(false);
  });

  it("flashes 2 times each second at most and ends on the ready color", () => {
    const plan = flashPlan(false);
    expect(plan.intervalMs).toBeGreaterThanOrEqual(500);
    expect(plan.changes % 2).toBe(0);
    expect(plan.changes * plan.intervalMs).toBeGreaterThanOrEqual(3000);
    expect([0, 1, 2, 3].map((done) => flashIsAlternate(done, plan))).toEqual([false, true, false, true]);
    expect(flashIsAlternate(plan.changes, plan)).toBe(false);
  });

  it("shows a solid color with reduced motion", () => {
    const plan = flashPlan(true);
    expect(plan.changes).toBe(0);
    expect(flashIsAlternate(1, plan)).toBe(false);
  });

  it("offers alerts only while the order can still become ready", () => {
    const states: OrderState[] = ["requested", "approved", "received", "preparing"];
    for (const state of states) expect(waitsForReady(state)).toBe(true);
    for (const state of ["ready", "handed_over", "declined", "canceled", "expired"] as OrderState[]) {
      expect(waitsForReady(state)).toBe(false);
    }
  });
});

describe("resume", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key)
      }
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("saves an open order and clears it at a final state", () => {
    expect(resumeAction("received")).toBe("save");
    expect(resumeAction("ready")).toBe("save");
    for (const state of ["handed_over", "declined", "canceled", "expired"] as OrderState[]) {
      expect(isFinalTrackerState(state)).toBe(true);
      expect(resumeAction(state)).toBe("clear");
    }
  });

  it("returns the saved token for 48 hours", () => {
    const now = 1_800_000_000_000;
    saveActiveTracker(TOKEN, now);
    expect(activeTrackerToken(now + 1000)).toBe(TOKEN);
    expect(activeTrackerPath(now + 1000)).toBe(`/t/${TOKEN}`);
    expect(activeTrackerToken(now + RESUME_MAX_AGE_MS + 1)).toBeNull();
  });

  it("clears only the entry of the same order", () => {
    saveActiveTracker(TOKEN, 1000);
    clearActiveTracker("b".repeat(48));
    expect(activeTrackerToken(2000)).toBe(TOKEN);
    clearActiveTracker(TOKEN);
    expect(activeTrackerToken(2000)).toBeNull();
  });

  it("ignores text that is not a valid entry", () => {
    expect(parseResume(null, 0)).toBeNull();
    expect(parseResume("not json", 0)).toBeNull();
    expect(parseResume(JSON.stringify({ trackerToken: "x/y", savedAt: 0 }), 0)).toBeNull();
    expect(parseResume(JSON.stringify({ trackerToken: TOKEN, savedAt: 5000 }), 1000)).toBeNull(); // in the future
  });

  it("works when storage throws", () => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        }
      }
    };
    expect(() => saveActiveTracker(TOKEN)).not.toThrow();
    expect(activeTrackerToken()).toBeNull();
    expect(() => clearActiveTracker()).not.toThrow();
  });
});
