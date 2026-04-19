import React from "react";

export function ResviaLogo({ className = "", hideText = false }: { className?: string; hideText?: boolean }) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <img
        src="/favicon.png.png"
        alt="Resvia"
        className="h-16 w-16 shrink-0 rounded-2xl"
        aria-hidden="true"
      />

      {!hideText && (
        <div className="space-y-0.5 text-left">
          <span className="block text-3xl font-semibold tracking-tight text-slate-900">Resvia</span>
          <span className="block text-sm text-slate-500">Resvia Booking</span>
        </div>
      )}
    </div>
  );
}
