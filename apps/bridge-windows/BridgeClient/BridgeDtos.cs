using System.Text.Json.Serialization;

namespace BridgeClient;

/// <summary>
/// DTOs do protocolo do BFF (spec Fase 1C, seção 2) — nomes de propriedade
/// JSON batem exatamente com o contrato já implementado em
/// apps/bff/src/routes/biometric-bridge.ts. snake_case explícito via
/// [JsonPropertyName] pra não depender de policy global de serialização.
/// </summary>

// ── /pair (2.2) ──────────────────────────────────────────────────────────
public sealed record PairRequest(
    [property: JsonPropertyName("pairing_code")] string PairingCode,
    [property: JsonPropertyName("public_key")] string PublicKey,
    [property: JsonPropertyName("sdk_vendor")] string? SdkVendor,
    [property: JsonPropertyName("sdk_version")] string? SdkVersion,
    [property: JsonPropertyName("bridge_version")] string? BridgeVersion,
    [property: JsonPropertyName("machine_name_hash")] string? MachineNameHash,
    [property: JsonPropertyName("hardware_serial_hash")] string? HardwareSerialHash);

public sealed record PairResponse(
    [property: JsonPropertyName("device_id")] string DeviceId,
    [property: JsonPropertyName("tenant_id")] string TenantId,
    [property: JsonPropertyName("reserve_id")] string ReserveId);

// ── /heartbeat (2.3) ─────────────────────────────────────────────────────
public sealed record HeartbeatRequest(
    [property: JsonPropertyName("bridge_version")] string BridgeVersion,
    [property: JsonPropertyName("sdk_version")] string? SdkVersion,
    [property: JsonPropertyName("driver_version")] string? DriverVersion,
    [property: JsonPropertyName("device_detected")] bool DeviceDetected,
    [property: JsonPropertyName("device_model")] string? DeviceModel,
    [property: JsonPropertyName("last_error_code")] string? LastErrorCode);

// ── /challenges/next (2.4) ───────────────────────────────────────────────
public sealed record ChallengeEnvelope(
    [property: JsonPropertyName("challenge")] Challenge? Challenge,
    [property: JsonPropertyName("poll_after_ms")] int PollAfterMs);

public sealed record Challenge(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("tenant_id")] string TenantId,
    [property: JsonPropertyName("reserve_id")] string ReserveId,
    [property: JsonPropertyName("actor_id")] string ActorId,
    [property: JsonPropertyName("purpose")] string Purpose,
    [property: JsonPropertyName("expected_user_id")] string? ExpectedUserId,
    [property: JsonPropertyName("document_type")] string? DocumentType,
    [property: JsonPropertyName("document_id")] string? DocumentId,
    [property: JsonPropertyName("document_hash")] string? DocumentHash,
    [property: JsonPropertyName("expires_at")] string ExpiresAt);

// ── /templates/sync (2.5) ────────────────────────────────────────────────
public sealed record TemplateSyncResponse(
    [property: JsonPropertyName("templates")] IReadOnlyList<SyncedTemplate> Templates,
    [property: JsonPropertyName("next_cursor")] string? NextCursor);

public sealed record SyncedTemplate(
    [property: JsonPropertyName("user_id")] string UserId,
    [property: JsonPropertyName("finger_index")] int FingerIndex,
    [property: JsonPropertyName("template_data")] string TemplateData,
    [property: JsonPropertyName("template_hash")] string TemplateHash,
    [property: JsonPropertyName("format")] string Format,
    [property: JsonPropertyName("sdk_version")] string? SdkVersion,
    [property: JsonPropertyName("quality")] int Quality,
    [property: JsonPropertyName("updated_at")] string UpdatedAt);

// ── /tenant-key (3.2) ────────────────────────────────────────────────────
public sealed record TenantKeyResponse(
    [property: JsonPropertyName("tenant_key")] string TenantKey,
    [property: JsonPropertyName("algorithm")] string Algorithm);
