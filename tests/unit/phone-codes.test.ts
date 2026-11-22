/** Registration phone numbers: the company country's dialling code by default. */
import { describe, expect, it } from "vitest";
import { dialCodeOf, splitDialCode, withDialCode } from "@/lib/phone-codes";

describe("phone dialling codes", () => {
  it("code per country", () => {
    expect(dialCodeOf("PT")).toBe("+351");
    expect(dialCodeOf("es")).toBe("+34");
    expect(dialCodeOf("DE")).toBe("+49");
    expect(dialCodeOf(null)).toBe("+351");
  });
  it("national numbers get the country's code; international ones stay", () => {
    expect(withDialCode("912 345 678", "PT")).toBe("+351 912 345 678");
    expect(withDialCode("030 1234567", "DE")).toBe("+49 30 1234567");
    expect(withDialCode("06 1234 5678", "IT")).toBe("+39 06 1234 5678");
    expect(withDialCode("+34 600 000 000", "PT")).toBe("+34 600 000 000");
    expect(withDialCode("0049 30 123", "PT")).toBe("+49 30 123");
    expect(withDialCode("", "PT")).toBe("");
  });
  it("splits the code off", () => {
    expect(splitDialCode("+351 912 345 678")).toEqual({ code: "+351", rest: "912 345 678" });
    expect(splitDialCode("+352 621 000")).toEqual({ code: "+352", rest: "621 000" });
    expect(splitDialCode("912")).toEqual({ code: null, rest: "912" });
  });
});
