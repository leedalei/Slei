import { Check, ChevronDown } from "lucide-react";

export function SelectControl<TValue extends string>(input: {
  ariaLabel?: string;
  className?: string;
  onChange: (value: TValue) => void;
  options: Array<{ label: string; value: TValue; disabled?: boolean }>;
  value: TValue;
}) {
  return (
    <span className={`slei-select${input.className ? ` ${input.className}` : ""}`}>
      <select
        aria-label={input.ariaLabel}
        className="slei-select__control"
        onChange={(event) => input.onChange(event.currentTarget.value as TValue)}
        value={input.value}
      >
        {input.options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="slei-select__icon" size={16} strokeWidth={2.8} />
    </span>
  );
}

export function CheckboxControl(input: {
  checked?: boolean;
  className?: string;
  disabled?: boolean;
  label: string;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className={`slei-checkbox${input.className ? ` ${input.className}` : ""}`}>
      <input
        checked={input.checked ?? false}
        className="slei-checkbox__control"
        disabled={input.disabled}
        onChange={(event) => input.onChange?.(event.currentTarget.checked)}
        type="checkbox"
      />
      <span className="slei-checkbox__box" aria-hidden="true">
        <Check size={14} strokeWidth={3.2} />
      </span>
      <span className="slei-checkbox__label">{input.label}</span>
    </label>
  );
}
