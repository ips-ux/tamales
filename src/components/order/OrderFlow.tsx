// The customer order flow, shared by the order page, the mobile order page,
// and the kiosk. The props below are the contract between those screens.
import type { CreateOrderResult, EventRecord, OrderKind, OrderSource } from "../../../shared/model";

export interface OrderFlowProps {
  /** live = at an event now. preorder = for an event. batch = no event. */
  kind: OrderKind;
  /** web = order page. mobile = /e/{id} on a phone. kiosk = the tablet at the event. */
  source: OrderSource;
  /** Required for live and preorder. For a kiosk batch request, the kiosk's event. */
  event?: EventRecord;
  /** Required when source is "kiosk". */
  kioskToken?: string;
  /** Called 1 time after the Worker saves the order. */
  onDone: (result: CreateOrderResult) => void;
  /** Shows a "Back" action on the first step when present. */
  onCancel?: () => void;
}

export function OrderFlow(_props: OrderFlowProps) {
  // Placeholder. Build piece 2, round 2 replaces this body.
  return null;
}
