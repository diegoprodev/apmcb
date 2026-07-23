using System.Text.Json;

namespace BridgeClient;

/// <summary>Opções JSON compartilhadas — sem policy de nome (DTOs usam [JsonPropertyName] explícito).</summary>
public static class BridgeJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        // Não emitir null pra campos opcionais do request seria mais enxuto,
        // mas o BFF aceita null explícito e alguns campos são obrigatórios
        // como null (ex: matched_user_id em failure) — manter default
        // (inclui null) evita divergência sutil de contrato.
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never,
    };

    public static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, Options)
        ?? throw new InvalidOperationException($"JSON desserializou para null: {typeof(T).Name}");

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
}
