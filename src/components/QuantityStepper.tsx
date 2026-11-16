import { Minus, Plus } from "lucide-react";
import { stepQuantity } from "./order/orderFlowLogic";

interface QuantityStepperProps {
  label: string;
  value: number;
  /** The smallest quantity above 0. The first + goes to it, and a - below it goes to 0. */
  minimum?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function QuantityStepper({
  label,
  value,
  minimum = 1,
  max = 99,
  disabled = false,
  onChange
}: QuantityStepperProps) {
  const up = stepQuantity(value, 1, minimum, max);
  const down = stepQuantity(value, -1, minimum, max);

  return (
    <div className="quantity-stepper" role="group" aria-label={`Quantity: ${label}`}>
      <button
        type="button"
        className="icon-button"
        aria-label={`Decrease quantity of ${label}`}
        onClick={() => onChange(down)}
        disabled={disabled || value <= 0}
      >
        <Minus size={17} aria-hidden="true" />
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        className="icon-button"
        aria-label={`Increase quantity of ${label}`}
        onClick={() => onChange(up)}
        disabled={disabled || up === value}
      >
        <Plus size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
