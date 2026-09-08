"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { X } from "lucide-react";
import { cn } from "@/lib/util";

/* ─── Tooltip ────────────────────────────────────────────────────────────── */
export const TooltipProvider = TooltipPrimitive.Provider;

export function Tip({
  label,
  kbd,
  side = "right",
  children,
}: {
  label: React.ReactNode;
  kbd?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactElement;
}) {
  return (
    <TooltipPrimitive.Root delayDuration={350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="z-[200] flex items-center gap-2 rounded-md bg-ink px-2.5 py-1.5 text-[12px] font-medium text-white shadow-pop fade-up select-none"
        >
          {label}
          {kbd && <span className="kbd !bg-white/10 !border-white/10 !text-white/80">{kbd}</span>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ─── Buttons ────────────────────────────────────────────────────────────── */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: "sm" | "md" | "lg"; danger?: boolean }
>(function IconButton({ active, size = "md", danger, className, ...props }, ref) {
  const dims = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-10 w-10" : "h-8 w-8";
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex items-center justify-center rounded-md transition-colors duration-100 disabled:opacity-40 disabled:pointer-events-none",
        dims,
        active ? "bg-ink text-white hover:bg-ink" : danger ? "text-red hover:bg-red-soft" : "text-ink-2 hover:bg-hover hover:text-ink",
        className,
      )}
      {...props}
    />
  );
});

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }
>(function Button({ variant = "secondary", size = "md", className, ...props }, ref) {
  const v = {
    primary: "bg-ink text-white hover:bg-black",
    secondary: "bg-panel text-ink hairline hover:bg-hover",
    ghost: "text-ink-2 hover:bg-hover hover:text-ink",
    danger: "bg-red text-white hover:bg-red-ink",
  }[variant];
  const s = size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]";
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none",
        v,
        s,
        className,
      )}
      {...props}
    />
  );
});

/* ─── Popover ────────────────────────────────────────────────────────────── */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export function PopoverContent({
  className,
  side = "bottom",
  align = "start",
  ...props
}: PopoverPrimitive.PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        side={side}
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={cn("z-[150] rounded-lg bg-panel shadow-pop hairline fade-up outline-none", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/* ─── Dialog ─────────────────────────────────────────────────────────────── */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export function DialogContent({
  title,
  description,
  children,
  className,
  width = 440,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  width?: number;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[180] bg-ink/25 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        style={{ width, maxWidth: "calc(100vw - 32px)" }}
        className={cn(
          "fixed left-1/2 top-1/2 z-[190] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-panel p-5 shadow-pop hairline fade-up outline-none",
          className,
        )}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="text-[15px] font-semibold text-ink">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-0.5 text-[12.5px] text-ink-2">{description}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <IconButton size="sm" aria-label="Close">
              <X size={15} />
            </IconButton>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export const DialogClose = DialogPrimitive.Close;

/* ─── Dropdown menu ─────────────────────────────────────────────────────── */
export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;
export function MenuContent({ className, ...props }: DropdownPrimitive.DropdownMenuContentProps) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={6}
        collisionPadding={8}
        className={cn("z-[160] min-w-[180px] rounded-lg bg-panel p-1 shadow-pop hairline fade-up outline-none", className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}
export function MenuItem({ className, danger, ...props }: DropdownPrimitive.DropdownMenuItemProps & { danger?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] outline-none data-[highlighted]:bg-hover",
        danger ? "text-red" : "text-ink",
        className,
      )}
      {...props}
    />
  );
}
export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-line" />;
}
export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">{children}</div>;
}
export const MenuCheckboxItem = DropdownPrimitive.CheckboxItem;
export const MenuRadioGroup = DropdownPrimitive.RadioGroup;
export const MenuRadioItem = DropdownPrimitive.RadioItem;

/* ─── Avatar ─────────────────────────────────────────────────────────────── */
export function Avatar({ name, color, size = 22, className }: { name: string; color: string; size?: number; className?: string }) {
  const initialsOf = (n: string) => {
    const p = n.trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "?";
    return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
  };
  return (
    <span
      title={name}
      style={{ width: size, height: size, background: color, fontSize: Math.max(9, size * 0.42) }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none", className)}
    >
      {initialsOf(name)}
    </span>
  );
}

/* ─── Field ─────────────────────────────────────────────────────────────── */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-md bg-panel px-2.5 text-[13px] text-ink hairline placeholder:text-ink-3 focus:shadow-[0_0_0_2px_var(--blue)] transition-shadow",
        className,
      )}
      {...props}
    />
  );
});

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-md bg-hover p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[5px] px-2 py-1 text-[12px] font-medium transition-colors",
            value === o.value ? "bg-panel text-ink shadow-sm" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
