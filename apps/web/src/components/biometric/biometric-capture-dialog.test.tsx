// Achados do gate de hardware (2026-09-23): (1) a tela mostrava "Tentativa
// 838b7c3d" e "Confirmação xxxx · N% de confiança" — termo técnico que nunca
// deve aparecer pro usuário; (2) polling com setInterval empilhava requests
// (respostas lentas do BFF) e estourava o rate limit (429) com dezenas de
// erros no console; (3) uma falha transitória derrubava a tela pra "retry".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BiometricCaptureDialog } from "./biometric-capture-dialog";

const mocks = vi.hoisted(() => ({ bffFetch: vi.fn() }));
vi.mock("@/lib/bff-client", () => ({ bffFetch: mocks.bffFetch }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const CHALLENGE_ID = "838b7c3d-6277-40f4-9375-022d02e466be";
const PROOF_ID = "9f8e7d6c-1111-2222-3333-444455556666";
const future = () => new Date(Date.now() + 120_000).toISOString();

function pendingResult() {
  return { ok: true, status: 200, data: { challenge: { id: CHALLENGE_ID, status: "pending", expires_at: future(), consumed_at: null }, proof: null, matched_user: null } };
}

function successResult() {
  return {
    ok: true, status: 200,
    data: {
      challenge: { id: CHALLENGE_ID, status: "completed", expires_at: future(), consumed_at: null },
      proof: { id: PROOF_ID, result: "success", failure_reason: null, match_score: 0.98, finger_index: 7, created_at: "" },
      matched_user: { id: "u1", nome_completo: "Fulano de Tal", nome_de_guerra: null, matricula: "000003", posto: "Sd", role: "usuario", registration_status: "ativo" },
    },
  };
}

function wire(resultResponses: Array<() => unknown>) {
  let resultCalls = 0;
  mocks.bffFetch.mockImplementation(async (method: string, path: string) => {
    if (method === "GET" && path.startsWith("/api/biometric/devices")) {
      return { ok: true, status: 200, data: { devices: [{ status: "active" }] } };
    }
    if (method === "POST" && path === "/api/biometric/challenges") {
      return { ok: true, status: 201, data: { challenge: { id: CHALLENGE_ID, expires_at: future(), status: "pending" } } };
    }
    if (method === "GET" && path.includes("/result")) {
      const next = resultResponses[Math.min(resultCalls, resultResponses.length - 1)];
      resultCalls += 1;
      return next();
    }
    throw new Error(`chamada inesperada ${method} ${path}`);
  });
  return () => resultCalls;
}

async function startCapture(onResult = vi.fn(), purpose: "enroll" | "identify" = "enroll") {
  render(<BiometricCaptureDialog reserveId="r1" canCapture purpose={purpose} expectedUserId="u1" onResult={onResult} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { fireEvent.click(screen.getByTestId("btn-biometric-identify")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return onResult;
}

beforeEach(() => { vi.useFakeTimers(); mocks.bffFetch.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("BiometricCaptureDialog", () => {
  it("nunca mostra código de tentativa/confirmação nem percentual de confiança", async () => {
    wire([successResult]);
    const onResult = await startCapture();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/Fulano de Tal/).length).toBeGreaterThan(0);
    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/Tentativa/);
    expect(texto).not.toMatch(/Confirmação/);
    expect(texto).not.toMatch(/confiança/);
    expect(texto).not.toContain(CHALLENGE_ID.slice(0, 8));
    expect(texto).not.toContain(PROOF_ID.slice(0, 8));
  });

  it("cadastro concluído mostra o nome do dedo escolhido na janela do leitor", async () => {
    wire([successResult]); // finger_index 7 = indicador esquerdo
    await startCapture();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });

    expect(screen.getByText("Digital cadastrada")).toBeInTheDocument();
    expect(screen.getByText("Indicador esquerdo cadastrado com sucesso.")).toBeInTheDocument();
  });

  it("identificação recusada mostra mensagem amigável, nunca o motivo técnico do leitor", async () => {
    const recusada = () => ({
      ok: true, status: 200,
      data: {
        challenge: { id: CHALLENGE_ID, status: "completed", expires_at: future(), consumed_at: null },
        proof: { id: PROOF_ID, result: "failure", failure_reason: "nenhum candidato bateu", match_score: 0, finger_index: null, created_at: "" },
        matched_user: null,
      },
    });
    wire([recusada]);
    await startCapture(vi.fn(), "identify");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });

    expect(screen.getByText("Digital não reconhecida")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/candidato/i);
    expect(document.body.textContent).not.toMatch(/d+%/);
    expect(screen.getByTestId("btn-biometric-retry")).toBeInTheDocument();
  });

  it("identificação concluída mostra 'Identidade confirmada' com nome, posto e matrícula", async () => {
    wire([successResult]);
    await startCapture(vi.fn(), "identify");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });

    expect(screen.getByText("Identidade confirmada")).toBeInTheDocument();
    expect(screen.getByText("Fulano de Tal")).toBeInTheDocument();
    expect(screen.getByText("Sd · Mat. 000003")).toBeInTheDocument();
  });

  it("enquanto aguarda o dedo não exibe id do desafio", async () => {
    wire([pendingResult]);
    await startCapture();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });

    expect(screen.getByText("Siga a janela do leitor")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CHALLENGE_ID.slice(0, 8));
  });

  it("depois de alguns segundos a espera vira fases animadas (validando, localizando biometria...)", async () => {
    wire([pendingResult]);
    await startCapture(vi.fn(), "identify");

    expect(screen.getByText("Aguardando o dedo")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
    expect(screen.getByText("Validando seus dados…")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_700); });
    expect(screen.getByText("Localizando biometria…")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CHALLENGE_ID.slice(0, 8));
  });

  it("polling é sequencial: resposta lenta não empilha requests", async () => {
    let resolveSlow: (v: unknown) => void = () => {};
    const calls = wire([
      () => new Promise((resolve) => { resolveSlow = resolve; }),
      pendingResult,
    ]);
    await startCapture();

    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); }); // 1º poll em voo, sem resposta
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); }); // muito tempo depois
    expect(calls()).toBe(1); // nada empilhado enquanto o anterior não terminou

    await act(async () => { resolveSlow(pendingResult()); await vi.advanceTimersByTimeAsync(2_100); });
    expect(calls()).toBeGreaterThanOrEqual(2);
  });

  it("429 transitório respeita o Retry-After e não derruba a tela pra 'tentar novamente'", async () => {
    const tooMany = () => ({ ok: false, status: 429, data: { error: "Muitas tentativas. Tente novamente mais tarde.", retry_after_seconds: 4 } });
    const calls = wire([tooMany, pendingResult]);
    await startCapture();

    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); }); // 1º poll → 429
    expect(screen.getByText("Siga a janela do leitor")).toBeInTheDocument();
    expect(screen.queryByTestId("btn-biometric-retry")).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); }); // ainda dentro dos 4s pedidos
    expect(calls()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_800); }); // passou o Retry-After
    expect(calls()).toBe(2);
    expect(screen.queryByTestId("btn-biometric-retry")).not.toBeInTheDocument();
  });

  it("depois de várias falhas seguidas oferece 'Tentar novamente'", async () => {
    const fail = () => ({ ok: false, status: 500, data: { error: "x" } });
    wire([fail]);
    await startCapture();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000 * 6); });

    expect(screen.getByTestId("btn-biometric-retry")).toBeInTheDocument();
  });
});
