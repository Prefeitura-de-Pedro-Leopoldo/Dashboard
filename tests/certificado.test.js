import { describe, it, expect } from "vitest";
import { makeCode, verifyCode } from "../api/certificado.js";

describe("certificado: assinatura HMAC (round-trip)", () => {
  const cert = { nome: "João da Silva", curso: "Gestão Pública", carga: "8h", data: "2026-01-15" };

  it("um código gerado é validado e recupera os campos", () => {
    const code = makeCode(cert);
    const r = verifyCode(code);
    expect(r.valido).toBe(true);
    expect(r.cert).toEqual(cert);
  });

  it("código adulterado é rejeitado", () => {
    const code = makeCode(cert);
    expect(verifyCode(code + "x").valido).toBe(false);
    expect(verifyCode(code.slice(0, -1)).valido).toBe(false);
  });

  it("payload alterado quebra a assinatura", () => {
    const code = makeCode(cert);
    const [payload, sig] = code.split(".");
    const outro = makeCode({ ...cert, nome: "Maria" }).split(".")[0];
    expect(verifyCode(`${outro}.${sig}`).valido).toBe(false);
    expect(payload).not.toBe(outro);
  });

  it("entradas inválidas retornam valido:false sem lançar", () => {
    expect(verifyCode("").valido).toBe(false);
    expect(verifyCode(null).valido).toBe(false);
    expect(verifyCode("sememponto").valido).toBe(false);
  });
});
