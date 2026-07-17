import { Minus, Plus } from "lucide-react";

interface QuantityStepperProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function QuantityStepper({
  label,
  value,
  min = 0,
  max = 99,
  disabled = false,
  onChange
}: QuantityStepperProps) {
  return (
    <div className="quantity-stepper" aria-label={label}>
      <button
        type="button"
        className="icon-button"
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
      >
        <Minus size={17} />
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        className="icon-button"
        aria-label={`Increase ${label}`}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled}
      >
        <Plus size={17} />
      </button>
    </div>
  );
}
