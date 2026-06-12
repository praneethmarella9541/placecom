"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";

type PasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  wrapperClassName?: string;
};

export function PasswordInput({
  className,
  wrapperClassName,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={cn("relative", wrapperClassName)}>
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={cn("input-field w-full pr-10 text-sm", className)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
        aria-label={visible ? titleCase("Hide password") : titleCase("Show password")}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
