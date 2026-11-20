"use client";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item className={cn("rounded-xl border border-border bg-card shadow-card", className)} {...props} />;
}

export function AccordionTrigger({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn("flex flex-1 items-center justify-between gap-3 px-4 py-3 text-left text-[14px] font-medium transition-all hover:text-foreground [&[data-state=open]>svg]:rotate-180", className)}
        {...props}
      >
        {children}
        <ChevronDown size={16} className="shrink-0 text-muted-foreground transition-transform duration-200" aria-hidden />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content className="overflow-hidden text-[14px] data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down" {...props}>
      <div className={cn("px-4 pb-4 leading-6 text-ink-2", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
