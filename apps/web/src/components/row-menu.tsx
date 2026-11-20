"use client";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/primitives/dropdown-menu";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface RowMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Destructive items are grouped at the bottom, after a separator, in red. */
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

/**
 * The ⋯ menu for a row or a page object. Rule of thumb across the app:
 * the one action that fits the current state stays visible as a button; everything else lives here.
 */
export function RowMenu({ items, label = "More actions", className }: { items: RowMenuItem[]; label?: string; className?: string }) {
  const shown = items.filter((i) => !i.hidden);
  if (!shown.length) return null;
  const normal = shown.filter((i) => !i.danger);
  const danger = shown.filter((i) => i.danger);
  const row = (i: RowMenuItem) => (
    <DropdownMenuItem key={i.label} disabled={i.disabled} onSelect={i.onSelect} className={cn(i.danger && "text-neg [&_svg]:text-neg")}>
      {i.icon}
      {i.label}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={label} className={cn("px-1.5", className)}>
          <MoreHorizontal size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {normal.map(row)}
        {normal.length > 0 && danger.length > 0 && <DropdownMenuSeparator />}
        {danger.map(row)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
