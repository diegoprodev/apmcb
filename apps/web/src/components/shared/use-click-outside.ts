"use client";

import { useEffect, type RefObject } from "react";

/**
 * Fecha um painel/dropdown quando o usuário clica fora do elemento referenciado.
 * Extraído de ComboBox para reuso em AsyncComboBox e SearchableSelect.
 */
export function useClickOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutside();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [ref, onOutside]);
}
