"use client";
/** A phone number with the international code in front — by default the company's country's; another can be picked. */
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { ALL_DIAL_CODES, splitDialCode } from "@/lib/phone-codes";

export function PhoneWithCode({ id, name, dial, defaultValue, required, placeholder, testid }: { id: string; name: string; dial: string; defaultValue?: string | null; required?: boolean; placeholder?: string; testid?: string }) {
  const start = splitDialCode(defaultValue);
  const [code, setCode] = useState(start.code ?? dial);
  const [touched, setTouched] = useState(!!start.code);
  const [num, setNum] = useState(start.rest);
  // the company's country changed and the code wasn't picked by hand: follow the country
  useEffect(() => { if (!touched) setCode(dial); }, [dial, touched]);
  const full = num.trim().startsWith("+") || num.trim().startsWith("00") ? num.trim() : num.trim() ? `${code} ${num.trim()}` : "";
  return (
    <div className="flex min-w-0 gap-2">
      <select aria-label="+" className="h-9 w-24 shrink-0 rounded-md border bg-background px-2 text-sm tabular-nums" value={code} onChange={(e) => { setCode(e.target.value); setTouched(true); }} data-testid={testid ? `${testid}-code` : undefined}>
        {ALL_DIAL_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <Input id={id} type="tel" inputMode="tel" autoComplete="tel-national" className="min-w-0 flex-1" required={required} placeholder={placeholder ?? "912 345 678"} value={num} onChange={(e) => setNum(e.target.value)} data-testid={testid} />
      <input type="hidden" name={name} value={full} />
    </div>
  );
}
