import { describe, it, expect } from "vitest";
import {
  filtrarEventosRelatorio,
  participantePassaRelatorio,
  consolidarPorGrupo,
} from "../assets/js/metrics.js";

// ---------------------------------------------------------------------------
// Eventos de exemplo cobrindo as 3 situações + datas variadas.
// ---------------------------------------------------------------------------
const EVENTOS = [
  { id: "a", date: "2026-04-10", status: "realizado" },
  { id: "b", date: "2026-05-20", status: "realizado" },
  { id: "c", date: "2026-06-30", status: "agendado" },
  { id: "d", date: "2026-07-01", status: "agendado", inscricaoAberta: true },
  { id: "e", date: null, status: "realizado" }, // sem data
];

describe("filtrarEventosRelatorio (nível de evento)", () => {
  it("sem filtros retorna todos", () => {
    expect(filtrarEventosRelatorio(EVENTOS, {}).length).toBe(5);
    expect(filtrarEventosRelatorio(EVENTOS).length).toBe(5);
  });

  it("filtra por evento específico", () => {
    const r = filtrarEventosRelatorio(EVENTOS, { eventoId: "c" });
    expect(r.map((e) => e.id)).toEqual(["c"]);
  });

  it("situação: realizado", () => {
    expect(filtrarEventosRelatorio(EVENTOS, { status: "realizado" }).map((e) => e.id)).toEqual(["a", "b", "e"]);
  });

  it("situação: agendado", () => {
    expect(filtrarEventosRelatorio(EVENTOS, { status: "agendado" }).map((e) => e.id)).toEqual(["c", "d"]);
  });

  it("situação: inscrição aberta (o bug reportado)", () => {
    const r = filtrarEventosRelatorio(EVENTOS, { status: "aberta" });
    expect(r.map((e) => e.id)).toEqual(["d"]);
    expect(r.length).toBe(1); // NÃO pode ser 0
  });

  it("data inicial inclui a própria data e exclui anteriores; sem data sai", () => {
    const r = filtrarEventosRelatorio(EVENTOS, { dataIni: "2026-05-20" });
    expect(r.map((e) => e.id)).toEqual(["b", "c", "d"]);
  });

  it("data final inclui a própria data e exclui posteriores; sem data sai", () => {
    const r = filtrarEventosRelatorio(EVENTOS, { dataFim: "2026-06-30" });
    expect(r.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("intervalo de datas (ini + fim)", () => {
    const r = filtrarEventosRelatorio(EVENTOS, { dataIni: "2026-05-01", dataFim: "2026-06-30" });
    expect(r.map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("combina evento aberto + intervalo", () => {
    const r = filtrarEventosRelatorio(EVENTOS, { status: "aberta", dataIni: "2026-07-01" });
    expect(r.map((e) => e.id)).toEqual(["d"]);
  });

  it("ignora entradas nulas", () => {
    expect(filtrarEventosRelatorio([null, EVENTOS[0]], {}).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
const PARTS = [
  { nome: "Ana Souza", email: "ana@x.gov", secretaria: "Saúde", turma: "Turma 1", presente: true },
  { nome: "Bruno Lima", email: "bruno@y.gov", secretaria: "Educação", turma: "Turma 2", presente: false },
  { nome: "Carla Dias", email: "", secretaria: "Saúde", turma: "Turma 1", presente: false },
];

describe("participantePassaRelatorio (nível de participante)", () => {
  const passa = (f) => PARTS.filter((p) => participantePassaRelatorio(p, f));

  it("sem filtros passa todos", () => {
    expect(passa({}).length).toBe(3);
  });

  it("secretaria", () => {
    expect(passa({ secretaria: "Saúde" }).map((p) => p.nome)).toEqual(["Ana Souza", "Carla Dias"]);
  });

  it("turma", () => {
    expect(passa({ turma: "Turma 2" }).map((p) => p.nome)).toEqual(["Bruno Lima"]);
  });

  it("presença: só presentes", () => {
    expect(passa({ presenca: "presentes" }).map((p) => p.nome)).toEqual(["Ana Souza"]);
  });

  it("presença: só faltantes", () => {
    expect(passa({ presenca: "faltantes" }).map((p) => p.nome)).toEqual(["Bruno Lima", "Carla Dias"]);
  });

  it("busca por nome (case-insensitive)", () => {
    expect(passa({ busca: "bruno" }).map((p) => p.nome)).toEqual(["Bruno Lima"]);
  });

  it("busca por e-mail", () => {
    expect(passa({ busca: "ana@x" }).map((p) => p.nome)).toEqual(["Ana Souza"]);
  });

  it("busca por secretaria", () => {
    expect(passa({ busca: "educa" }).map((p) => p.nome)).toEqual(["Bruno Lima"]);
  });

  it("combina secretaria + presença", () => {
    expect(passa({ secretaria: "Saúde", presenca: "faltantes" }).map((p) => p.nome)).toEqual(["Carla Dias"]);
  });

  it("participante sem e-mail não quebra a busca", () => {
    expect(passa({ busca: "carla" }).map((p) => p.nome)).toEqual(["Carla Dias"]);
  });

  it("nulo não passa", () => {
    expect(participantePassaRelatorio(null, {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("consolidarPorGrupo propaga inscrição aberta", () => {
  it("grupo com uma turma aberta fica inscricaoAberta e herda pasta/fonte", () => {
    const turmas = [
      {
        id: "t1", title: "PL por Todos - Turma 1", date: "2026-06-30",
        inscricaoAberta: true, aceitandoInscricoes: true,
        pastaInscricao: "pl-por-todos-2026-06/turma 1",
        fonte: "pl-por-todos-2026-06/turma 1/participantes.xlsx",
        totalInscritos: 22, totalPresentes: 0,
        grupo: { id: "pl-por-todos-2026-06", titulo: "PL por Todos", turma: 1 },
      },
      {
        id: "t2", title: "PL por Todos - Turma 2", date: "2026-07-01",
        inscricaoAberta: true, aceitandoInscricoes: true,
        pastaInscricao: "pl-por-todos-2026-06/turma 2",
        fonte: "pl-por-todos-2026-06/turma 2/participantes.xlsx",
        totalInscritos: 18, totalPresentes: 0,
        grupo: { id: "pl-por-todos-2026-06", titulo: "PL por Todos", turma: 2 },
      },
    ];
    const grupos = consolidarPorGrupo(turmas);
    expect(grupos.length).toBe(1);
    const g = grupos[0];
    expect(g.inscricaoAberta).toBe(true);
    expect(g.pastaInscricao).toBe("pl-por-todos-2026-06/turma 1");
    expect(g.totalInscritos).toBe(40);
    // E o filtro de relatório agora acha o grupo como "inscrição aberta".
    expect(filtrarEventosRelatorio(grupos, { status: "aberta" }).length).toBe(1);
  });

  it("grupo sem turma aberta não vira inscrição aberta", () => {
    const turmas = [
      { id: "x1", date: "2026-05-01", status: "realizado", totalInscritos: 10, totalPresentes: 8, grupo: { id: "g", titulo: "Curso X", turma: 1 } },
      { id: "x2", date: "2026-05-08", status: "realizado", totalInscritos: 12, totalPresentes: 9, grupo: { id: "g", titulo: "Curso X", turma: 2 } },
    ];
    const g = consolidarPorGrupo(turmas)[0];
    expect(g.inscricaoAberta).toBeUndefined();
    expect(filtrarEventosRelatorio([g], { status: "aberta" }).length).toBe(0);
  });
});
