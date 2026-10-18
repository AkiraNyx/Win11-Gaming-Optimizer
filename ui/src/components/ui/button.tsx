"use client";
import type { ComponentProps } from "react";
import { Button as ArinoxButton } from "@arinox/react";
import { cn } from "@/lib/utils";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
};
export function Button({ variant = "default", size = "default", className, ...props }: ButtonProps) {
  return <ArinoxButton {...props}
    variant={variant === "default" ? "primary" : variant === "destructive" ? "danger" : variant === "ghost" || variant === "link" ? "ghost" : "neutral"}
    size={size === "lg" || size === "icon-lg" ? "lg" : ["sm", "xs", "icon-xs", "icon-sm"].includes(size) ? "sm" : "md"}
    data-slot="button" data-icon-only={size.startsWith("icon") || undefined}
    className={cn("optimizer-button", variant === "link" && "underline", size.startsWith("icon") && "optimizer-icon-button", className)} />;
}
