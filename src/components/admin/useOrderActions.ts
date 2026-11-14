import { useState } from "react";
import type { OrderAction, OrderActionInput, OrderRecord } from "../../../shared/model";
import { ApiError, runOrderAction } from "../../lib/api";

const FALLBACK_ERROR = "We could not save the change. Check your connection, then try again.";

export interface RunningAction {
  orderId: string;
  action: OrderAction;
}

/**
 * Runs an owner action on an order through the Worker. One action runs at a
 * time for each screen. The Firestore watcher shows the new state.
 */
export function useOrderActions() {
  const [running, setRunning] = useState<RunningAction | null>(null);
  const [failure, setFailure] = useState<{ orderId: string; message: string } | null>(null);

  async function run(
    order: OrderRecord,
    action: OrderAction,
    extra: Omit<OrderActionInput, "orderId" | "action"> = {}
  ): Promise<boolean> {
    if (running) return false;
    setRunning({ orderId: order.id, action });
    setFailure(null);
    try {
      await runOrderAction({ orderId: order.id, action, ...extra });
      return true;
    } catch (error) {
      setFailure({
        orderId: order.id,
        message: error instanceof ApiError ? error.message : FALLBACK_ERROR
      });
      return false;
    } finally {
      setRunning(null);
    }
  }

  return {
    run,
    running,
    /** True while an action runs on this order. */
    isBusy: (orderId: string) => running?.orderId === orderId,
    errorFor: (orderId: string) => (failure?.orderId === orderId ? failure.message : ""),
    clearError: () => setFailure(null)
  };
}
