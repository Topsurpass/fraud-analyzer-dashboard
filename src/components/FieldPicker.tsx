"use client";

import { Field, Select } from "@/components/ui";

/**
 * Choose a result column for one chart field.
 *
 * Extracted from QueryEditor when charts became separable from queries: the
 * chart editor needs exactly this control, and two copies would drift the
 * first time the "field no longer in the result" behaviour below changed.
 */
export function FieldPicker({
  label,
  id,
  value,
  columns,
  onChange,
  optional,
  hint,
  disabled,
}: {
  label: string;
  id: string;
  value: string;
  columns: string[];
  onChange: (value: string) => void;
  optional?: boolean;
  hint?: string;
  disabled?: boolean;
}) {
  // A configured field that is no longer in the result set must still be
  // listed, or opening the editor would silently drop it on save.
  const options = value && !columns.includes(value) ? [value, ...columns] : columns;

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{optional ? "None" : "Not set"}</option>
        {options.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </Select>
    </Field>
  );
}

