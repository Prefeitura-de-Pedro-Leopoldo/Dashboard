import { describe, it, expect } from "vitest";
import { matchSecretariaCanon } from "../lib/secretarias.mjs";
import { normalizeSecretaria as normalizeBuild } from "../scripts/build-data.mjs";
import { normalizeSecretaria as normalizeRaw } from "../scripts/normalize-planilhas.mjs";

describe("matchSecretariaCanon (mapa compartilhado)", () => {
  it("casa o nome canônico completo", () => {
    expect(matchSecretariaCanon("Secretaria Municipal de Saúde")).toBe(
      "Secretaria Municipal de Saúde",
    );
  });

  it("casa por sigla com fronteira de palavra (SMS)", () => {
    expect(matchSecretariaCanon("SMS")).toBe("Secretaria Municipal de Saúde");
  });

  it("casa siglas curtas só como palavra isolada (CGM)", () => {
    expect(matchSecretariaCanon("CGM")).toBe("Controladoria Geral do Município");
  });

  it("' ti ' casa palavra isolada, não substring de 'assistente'", () => {
    expect(matchSecretariaCanon("TI")).toBe("Secretaria Municipal de Gestão e Finanças");
    expect(matchSecretariaCanon("assistente")).toBeNull();
  });

  it("respeita a ordem: 'chefia de gabinete' antes de 'gabinete do prefeito'", () => {
    expect(matchSecretariaCanon("Chefia de Gabinete")).toBe("Chefia de Gabinete");
    expect(matchSecretariaCanon("Gabinete do Vice-Prefeito")).toBe("Gabinete do Vice-Prefeito");
  });

  it("ignora sufixo entre parênteses", () => {
    expect(matchSecretariaCanon("Saúde (PA Central)")).toBe("Secretaria Municipal de Saúde");
  });

  it("retorna null para vazio/nulo/sem correspondência", () => {
    expect(matchSecretariaCanon("")).toBeNull();
    expect(matchSecretariaCanon(null)).toBeNull();
    expect(matchSecretariaCanon("Departamento Inexistente")).toBeNull();
  });
});

describe("normalizeSecretaria - fallback do build-data (re-casing, null)", () => {
  it("usa Lotação quando a Secretaria não casa", () => {
    expect(normalizeBuild("", "PA Central")).toBe("Secretaria Municipal de Saúde");
  });

  it("aplica Title Case no fallback quando nada casa", () => {
    expect(normalizeBuild("departamento qualquer", null)).toBe("Departamento Qualquer");
  });

  it("retorna null quando não há nada", () => {
    expect(normalizeBuild(null, null)).toBeNull();
    expect(normalizeBuild("", "")).toBeNull();
  });
});

describe("normalizeSecretaria - fallback do normalize-planilhas (string crua, '')", () => {
  it("preserva a string crua (sem re-casing) quando nada casa", () => {
    expect(normalizeRaw("departamento qualquer", null)).toBe("departamento qualquer");
  });

  it("retorna '' quando não há nada", () => {
    expect(normalizeRaw(null, null)).toBe("");
  });

  it("ainda canoniza quando casa o mapa", () => {
    expect(normalizeRaw("SMS", null)).toBe("Secretaria Municipal de Saúde");
  });
});
