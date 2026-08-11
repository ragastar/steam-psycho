import { describe, it, expect } from "vitest";
import { getClientIp } from "@/lib/http/client-ip";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/x", { headers });
}

describe("определение адреса клиента (MON-5)", () => {
  it("берёт адрес, дописанный прокси, а не присланный клиентом", () => {
    // Клиент подставил чужой адрес, наш прокси дописал настоящий в конец.
    const ip = getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }));
    expect(ip).toBe("203.0.113.9");
  });

  it("не даёт обойти лимит подстановкой заголовка", () => {
    const spoofed = getClientIp(reqWith({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" }));
    const honest = getClientIp(reqWith({ "x-forwarded-for": "203.0.113.9" }));
    // Оба запроса должны попасть в одно ведро лимита.
    expect(spoofed).toBe(honest);
  });

  it("падает на x-real-ip, если forwarded нет", () => {
    expect(getClientIp(reqWith({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("отдаёт unknown, когда заголовков нет", () => {
    expect(getClientIp(reqWith({}))).toBe("unknown");
  });
});
