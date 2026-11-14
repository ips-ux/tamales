// After the Worker saves an order: keep the tracker link on this phone, then open the order tracker.
import type { CreateOrderResult } from "../../../shared/model";
import { navigate } from "../../App";
import { saveActiveTracker } from "../tracker/resume";

export function openTracker(result: CreateOrderResult): void {
  saveActiveTracker(result.trackerToken);
  navigate(`/t/${encodeURIComponent(result.trackerToken)}`);
}
