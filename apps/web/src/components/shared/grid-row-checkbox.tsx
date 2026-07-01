"use client";

import { cn } from "@/lib/utils";

interface GridRowCheckboxProps {
  checked: boolean;
  onChange: () => void;
  className?: string;
}

export function GridRowCheckbox({ checked, onChange, className }: GridRowCheckboxProps) {
  return (
    <td className={cn("px-4 py-2.5 w-10", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-4 rounded border-border accent-primary cursor-pointer"
        onClick={(e) => e.stopPropagation()}
      />
    </td>
  );
}

interface GridSelectAllProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  className?: string;
}

export function GridSelectAll({ checked, indeterminate, onChange, className }: GridSelectAllProps) {
  return (
    <th className={cn("px-4 py-2.5 w-10", className)}>
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => { if (el) el.indeterminate = indeterminate ?? false; }}
        onChange={onChange}
        className="size-4 rounded border-border accent-primary cursor-pointer"
      />
    </th>
  );
}
