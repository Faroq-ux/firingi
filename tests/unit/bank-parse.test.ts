import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dedupeKeys, detectFormat, parseAmount, parseDate } from "@/lib/bank/common";
import { parseCamt } from "@/lib/bank/camt";
import { parseMt940 } from "@/lib/bank/mt940";
import { guessMapping, linesFromRows } from "@/lib/bank/csv";

const fx = (f: string) => readFileSync(`tests/fixtures/bank/${f}`, "utf8");

describe("amounts and dates", () => {
  it("reads European and English number styles", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("-12,50")).toBe(-12.5);
    expect(parseAmount("12,50-")).toBe(-12.5);
    expect(parseAmount("(7.80)")).toBe(-7.8);
    expect(parseAmount("€ 1.000")).toBe(1000);
    expect(parseAmount("1,234,567")).toBe(1234567);
    expect(parseAmount("0,5")).toBe(0.5);
    expect(parseAmount("1.5", ",")).toBe(15); // forced decimal comma: the dot is a thousands mark
    expect(parseAmount("")).toBeNull();
  });
  it("reads dates in the usual orders", () => {
    expect(parseDate("2026-11-13")).toBe("2026-11-13");
    expect(parseDate("13/11/2026")).toBe("2026-11-13");
    expect(parseDate("13.11.26")).toBe("2026-11-13");
    expect(parseDate("11/13/2026", "MDY")).toBe("2026-11-13");
    expect(parseDate("20261113")).toBe("2026-11-13");
    expect(parseDate("31/13/2026")).toBeNull();
  });
});

describe("CAMT.053", () => {
  const [s] = parseCamt(fx("camt053.xml"));
  it("statement: account, period, balances (no entity tricks)", () => {
    expect(s.iban).toBe("PT50000201231234567890154");
    expect(s.bankStatementId).toBe("STMT-2026-321");
    expect([s.fromDate, s.toDate]).toEqual(["2026-11-13", "2026-11-15"]);
    expect([s.openingBalance, s.closingBalance]).toEqual([10000, 10840.3]);
  });
  it("lines: payer, IBAN, remittance joined, refs; batch split; pending left out", () => {
    expect(s.lines).toHaveLength(4);
    const [a, b, c, d] = s.lines;
    expect(a).toMatchObject({ bookingDate: "2026-11-13", amount: 615, counterparty: "Kebab House & Grill Lda", counterpartyIban: "PT50003300004567890123456", endToEndId: "KH-INV-77", bankRef: "BNK-0001" });
    expect(a.remittance).toBe("Pagamento FT FIR2026/12 e FT FIR2026/13 €");
    expect(b).toMatchObject({ amount: -74.7, counterparty: "Lisboa Central", endToEndId: null, remittance: "TRF-EP-1" });
    expect([c.amount, c.bankRef, c.counterparty, d.amount, d.bankRef]).toEqual([100, "BNK-0003-A", "Cliente A", 200, "BNK-0003-B"]);
    expect(s.openingBalance! + s.lines.reduce((x, l) => x + l.amount, 0)).toBeCloseTo(s.closingBalance!, 2);
  });
});

describe("MT940", () => {
  const [s] = parseMt940(fx("statement.sta"));
  it("account and balances", () => {
    expect(s.iban).toBe("DE89370400440532013000");
    expect([s.openingBalance, s.closingBalance, s.currency]).toEqual([5000, 4137.5, "EUR"]);
  });
  it("structured :86: (German ?-fields and /NAME/ style) and free text", () => {
    const [a, b, c] = s.lines;
    expect(a).toMatchObject({ bookingDate: "2026-11-13", amount: 150, counterparty: "Weinhaus Meier GmbH", counterpartyIban: "DE44500105175407324931", bankRef: "BR-9001" });
    expect(a.remittance).toContain("FT FIR2026/40");
    expect(b).toMatchObject({ amount: -12.5, remittance: "Kontofuehrungsgebuehr November" });
    expect(c).toMatchObject({ amount: -1000, counterparty: "Fornecedor Atlantico Lda", counterpartyIban: "PT50000700001111222233334", endToEndId: "PAY-77", remittance: "Pagamento extrato ST-2026-11" });
  });
});

describe("CSV with a mapping", () => {
  const rows = fx("statement.csv").split(/\r?\n/).filter(Boolean).map((l) => l.split(";"));
  const m = guessMapping(rows);
  it("guesses the header row, columns, number style and date order (Portuguese bank export)", () => {
    expect(m).toMatchObject({ headerRow: 3, date: "Data Mov.", valueDate: "Data Valor", debit: "Débito", credit: "Crédito", decimal: ",", dateOrder: "DMY" });
    expect(m.remittance).toEqual(["Descrição"]);
  });
  it("lines: signed amounts, the total row skipped; identical lines kept apart", () => {
    const { lines, skipped } = linesFromRows(rows, m);
    expect(lines.map((l) => l.amount)).toEqual([1230, -7.8, 1230]);
    expect(skipped).toBe(1);
    const keys = dedupeKeys([lines[0], { ...lines[0] }]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(dedupeKeys([lines[0]])[0]).toBe(keys[0]); // the same file again gives the same keys
  });
});

describe("format detection", () => {
  it("by content", () => {
    expect(detectFormat(fx("camt053.xml"))).toBe("CAMT053");
    expect(detectFormat(fx("statement.sta"))).toBe("MT940");
    expect(detectFormat(fx("statement.csv"), "x.csv")).toBe("CSV");
  });
});
