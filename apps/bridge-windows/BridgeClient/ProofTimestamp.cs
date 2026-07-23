namespace BridgeClient;

/// <summary>
/// Timestamp ISO 8601 pro campo `proof.timestamp` (spec Fase 1C, seção 2.6/
/// 2.7) — CRÍTICO de code review (2026-07-23): `DateTimeOffset.UtcNow.ToString("O")`
/// emite sufixo `+00:00` (nunca `Z`, mesmo em UTC — comportamento do
/// especificador "O"/round-trip para DateTimeOffset, diferente de DateTime).
/// O BFF valida `proof.timestamp` com Zod `z.string().datetime()` SEM
/// `{ offset: true }` (`apps/bff/src/routes/biometric-bridge.ts`,
/// `proofPayloadSchema`) — só aceita sufixo `Z` literal, rejeita `+00:00`
/// com 400. Sem este helper, TODO `/proof` e `/enrollment` falhava antes de
/// qualquer lógica de negócio rodar. `DateTime.UtcNow.ToString("O")` (não
/// DateTimeOffset) produz `Z` corretamente — usar SEMPRE este helper para
/// qualquer timestamp que vá no corpo JSON pro BFF, nunca `DateTimeOffset`
/// direto. (O header `X-Bridge-Timestamp` de device-auth é diferente — o BFF
/// parseia com `new Date(...)` do JS, tolerante a `+00:00`, então
/// DeviceAuthClient.cs não precisa deste helper.)
/// </summary>
public static class ProofTimestamp
{
    public static string UtcNowIso() => DateTime.UtcNow.ToString("O");
}
