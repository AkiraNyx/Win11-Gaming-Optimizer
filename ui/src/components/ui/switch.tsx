"use client";
import { Switch as ArinoxSwitch, type SwitchProps } from "@arinox/react";
export function Switch({ onCheckedChange, onChange, ...props }: SwitchProps & { onCheckedChange?: (checked: boolean) => void }) {
  return <ArinoxSwitch {...props} onChange={event => { onChange?.(event); if (!event.defaultPrevented) onCheckedChange?.(event.target.checked); }} />;
}
