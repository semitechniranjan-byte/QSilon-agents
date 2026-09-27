import { useState, type MouseEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { maskPhone } from "./Disposition";
import { IconClipboard } from "./Icons";

/**
 * A customer's number: in full for an admin, masked for everyone else.
 *
 * Masking every number protects a screen share, but it also stopped the one person
 * entitled to the number - the admin working the account - from reading it back or
 * dialling it by hand. Nothing changes for an operator.
 */
export function PhoneNumber({
  value,
  className = "",
}: {
  value?: string | null;
  className?: string;
}) {
  const { isAdmin } = useAuth();
  const [copied, setCopied] = useState(false);

  if (!value) return <span className={className}>—</span>;
  if (!isAdmin) {
    return (
      <span className={className} title="Hidden — an admin can see the full number">
        {maskPhone(value)}
      </span>
    );
  }

  const copy = async (e: MouseEvent) => {
    // The number often sits inside a row that is itself a link.
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard blocked (no permission, or an insecure origin): the number is on
      // screen anyway, so there is nothing to fall back to.
      setCopied(false);
    }
  };

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {value}
      <button
        onClick={copy}
        title={copied ? "Copied" : "Copy number"}
        className="rounded p-0.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
      >
        <IconClipboard size={12} />
      </button>
    </span>
  );
}
