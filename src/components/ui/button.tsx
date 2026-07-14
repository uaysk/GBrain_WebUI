import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800",
        active: "border-zinc-500 bg-zinc-700 text-white",
        ghost: "border-transparent bg-transparent text-zinc-300 hover:bg-zinc-900 hover:text-white",
      },
      size: { default: "px-3", icon: "w-8 px-0" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type Props = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: Props) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
