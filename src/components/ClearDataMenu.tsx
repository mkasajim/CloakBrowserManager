import { useEffect, useRef, useState } from "react";
import { ChevronDown, Cookie, HardDrive, Trash2 } from "lucide-react";
import type { ClearScope } from "../api";

const ITEMS: { scope: ClearScope; label: string; hint: string; icon: typeof Cookie }[] = [
  { scope: "cache", label: "Clear Cache", hint: "Cached files only", icon: HardDrive },
  { scope: "cookies", label: "Clear Cookies", hint: "Sign out of sites", icon: Cookie },
  { scope: "all", label: "Clear Data", hint: "Erase everything", icon: Trash2 },
];

export function ClearDataMenu({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (scope: ClearScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flex: "1 1 100%", marginTop: 4 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        style={{
          width: "100%",
          border: "1px solid var(--error)",
          color: "var(--error)",
          backgroundColor: "rgba(255, 180, 171, 0.05)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <Trash2 size={14} /> Clear Browser Data <ChevronDown size={14} />
      </button>

      {open && !disabled && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 20,
            border: "1px solid var(--border-zinc)",
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--bg-zinc)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
            overflow: "hidden",
          }}
        >
          {ITEMS.map(({ scope, label, hint, icon: Icon }) => (
            <button
              key={scope}
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect(scope);
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--border-zinc)",
                color: scope === "all" ? "var(--error)" : "var(--text-primary)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <Icon size={15} />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <strong style={{ fontSize: 13 }}>{label}</strong>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
