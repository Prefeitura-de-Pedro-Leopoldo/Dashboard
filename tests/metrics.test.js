import { describe, it, expect } from "vitest";
import {
  taxaPresenca,
  taxaOcupacao,
  totalAusentes,
  totalVagasOuIngressos,
  totalPresentes,
} from "../assets/js/metrics.js";

describe("taxaPresenca = presentes/inscritos", () => {
  it("calcula com 1 casa decimal", () => {
    expect(taxaPresenca({ totalInscritos: 4, totalPresentes: 1 })).toBe(25);
    expect(taxaPresenca({ totalInscritos: 3, totalPresentes: 2 })).toBe(66.7);
  });

  it("null quando não há inscritos", () => {
    expect(taxaPresenca({ totalInscritos: 0, totalPresentes: 0 })).toBeNull();
  });
});

describe("taxaOcupacao = inscritos/vagas", () => {
  it("calcula quando há vagas", () => {
    expect(taxaOcupacao({ vagas: 4, totalInscritos: 2 })).toBe(50);
  });

  it("null quando não há vagas", () => {
    expect(taxaOcupacao({ totalInscritos: 2 })).toBeNull();
    expect(taxaOcupacao({ vagas: 0, totalInscritos: 2 })).toBeNull();
  });
});

describe("auxiliares", () => {
  it("totalAusentes nunca é negativo", () => {
    expect(totalAusentes({ totalInscritos: 10, totalPresentes: 3 })).toBe(7);
    expect(totalAusentes({ totalInscritos: 3, totalPresentes: 10 })).toBe(0);
  });

  it("totalVagasOuIngressos e totalPresentes lidam com ausência de dados", () => {
    expect(totalVagasOuIngressos({ vagas: 5 })).toBe(5);
    expect(totalVagasOuIngressos({})).toBeNull();
    expect(totalPresentes({})).toBe(0);
  });
});
