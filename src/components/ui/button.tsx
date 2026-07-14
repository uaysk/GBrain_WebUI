import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:bg-zinc-600 focus-visible:text-white disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "bg-zinc-800/80 text-zinc-100 hover:bg-zinc-700",
        active: "bg-zinc-600 text-white hover:bg-zinc-500",
        ghost: "bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-white",
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
