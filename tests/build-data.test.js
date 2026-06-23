import { describe, it, expect } from "vitest";
import { slugify, buildEvento, buildResumo } from "../scripts/build-data.mjs";

describe("slugify", () => {
  it("remove acentos e normaliza separadores", () => {
    expect(slugify("Comunicação que Aproxima")).toBe("comunicacao-que-aproxima");
  });

  it("apara hifens das pontas", () => {
    expect(slugify("  Olá, Mundo!  ")).toBe("ola-mundo");
  });
});

describe("buildEvento (sem módulos)", () => {
  const participantes = [
    { presente: true, secretaria: "Secretaria Municipal de Saúde", turma: "T1" },
    { presente: false, secretaria: "Secretaria Municipal de Saúde", turma: "T1" },
    { presente: true, secretaria: "Secretaria Municipal de Educação", turma: "T2" },
  ];
  const meta = { id: "ev", title: "Evento", date: "2020-01-01", vagas: 6 };
  const ev = buildEvento("pasta/participantes.xlsx", meta, participantes);

  it("conta inscritos, presentes e ausentes", () => {
    expect(ev.totalInscritos).toBe(3);
    expect(ev.totalPresentes).toBe(2);
    expect(ev.totalAusentes).toBe(1);
  });

  it("taxa de presença = presentes/inscritos (1 casa)", () => {
    expect(ev.taxaPresenca).toBe(66.7);
  });

  it("ocupação = inscritos/vagas", () => {
    expect(ev.taxaOcupacao).toBe(50);
  });

  it("evento com data passada e inscritos é 'realizado'", () => {
    expect(ev.status).toBe("realizado");
  });

  it("agrega por secretaria (inscritos e presentes)", () => {
    expect(ev.secretarias["Secretaria Municipal de Saúde"]).toBe(2);
    expect(ev.secretariasPresentes["Secretaria Municipal de Saúde"]).toBe(1);
    expect(ev.secretariasPresentes["Secretaria Municipal de Educação"]).toBe(1);
  });
});

describe("buildEvento (sem vagas)", () => {
  it("ocupação 0 quando não há vagas declaradas (vagas = inscritos)", () => {
    const ev = buildEvento("x.xlsx", { id: "x", title: "X", date: "2020-01-01" }, [
      { presente: true, secretaria: "A" },
    ]);
    // meta.vagas ausente => vagas = totalInscritos => ocupação 100
    expect(ev.vagas).toBe(1);
    expect(ev.taxaOcupacao).toBe(100);
  });
});

describe("buildResumo", () => {
  it("consolida totais e ranking entre eventos", () => {
    const eventos = [
      {
        status: "realizado",
        totalInscritos: 10,
        totalPresentes: 6,
        vagas: 20,
        secretarias: { A: 7, B: 3 },
      },
      {
        status: "agendado",
        totalInscritos: 5,
        totalPresentes: 0,
        vagas: 10,
        secretarias: { A: 2 },
      },
    ];
    const r = buildResumo(eventos);
    expect(r.totalEventos).toBe(2);
    expect(r.eventosRealizados).toBe(1);
    expect(r.eventosAgendados).toBe(1);
    expect(r.totalInscritos).toBe(15);
    expect(r.totalPresentes).toBe(6);
    expect(r.totalAusentes).toBe(9);
    expect(r.totalVagas).toBe(30);
    expect(r.taxaPresencaGlobal).toBe(40);
    expect(r.taxaOcupacaoGlobal).toBe(50);
    expect(r.rankingSecretarias).toEqual({ A: 9, B: 3 });
  });
});
