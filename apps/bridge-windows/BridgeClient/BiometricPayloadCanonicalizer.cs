using System.Globalization;
using System.Text;

namespace BridgeClient;

/// <summary>
/// Espelha byte a byte apps/bff/src/lib/biometric-proof.ts (normalize +
/// canonicalizeBiometricPayload) — usado pra assinar/verificar o payload
/// de PROOF (identify/confirm) e de ENROLLMENT (proof + template_hash +
/// format + quality), separado da assinatura de device-auth
/// (DeviceAuthCanonicalizer, que assina o REQUEST HTTP, não este payload).
///
/// Contrato do BFF: ordena as chaves de cada objeto alfabeticamente
/// (recursivo), remove chaves com valor `undefined` (aqui: não incluídas
/// no dicionário), depois serializa com JSON.stringify. Implementado à
/// mão (não System.Text.Json) porque o encoder padrão do .NET escapa
/// caracteres que JSON.stringify do JS não escapa por padrão (ex: `&`,
/// `<`, `>`, alguns unicode) — divergência silenciosa que quebraria TODA
/// verificação de assinatura sem avisar. Os payloads reais aqui só têm
/// UUIDs/timestamps ISO/enums ASCII/números/booleanos/null — a única
/// diferença que realmente importa é ordenação de chave + ausência de
/// espaço, ambas garantidas aqui.
/// </summary>
public static class BiometricPayloadCanonicalizer
{
    public static string Canonicalize(IReadOnlyDictionary<string, object?> payload)
    {
        var sb = new StringBuilder();
        WriteValue(sb, payload);
        return sb.ToString();
    }

    private static void WriteValue(StringBuilder sb, object? value)
    {
        switch (value)
        {
            case null:
                sb.Append("null");
                break;
            case bool b:
                sb.Append(b ? "true" : "false");
                break;
            case string s:
                WriteJsonString(sb, s);
                break;
            case int or long:
                sb.Append(Convert.ToString(value, CultureInfo.InvariantCulture));
                break;
            case double d:
                // JSON.stringify de double sem parte fracionária (ex: 1.0)
                // imprime "1", não "1.0" — replica isso pra números inteiros
                // representados como double (ex: score 1.0 -> "1").
                sb.Append(d == Math.Truncate(d) && !double.IsInfinity(d)
                    ? ((long)d).ToString(CultureInfo.InvariantCulture)
                    : d.ToString("R", CultureInfo.InvariantCulture));
                break;
            case IReadOnlyDictionary<string, object?> dict:
                WriteObject(sb, dict);
                break;
            case System.Collections.IEnumerable list and not string:
                WriteArray(sb, list);
                break;
            default:
                throw new ArgumentException($"Tipo não suportado no payload canônico: {value.GetType()}");
        }
    }

    private static void WriteObject(StringBuilder sb, IReadOnlyDictionary<string, object?> dict)
    {
        sb.Append('{');
        var first = true;
        foreach (var key in dict.Keys.OrderBy(k => k, StringComparer.Ordinal))
        {
            var val = dict[key];
            // Chaves com valor null SÃO incluídas (JS: só `undefined` é
            // removido; `null` explícito permanece) — refletido aqui
            // porque o dicionário só contém entradas que o chamador
            // decidiu incluir; nunca omitir uma chave presente.
            if (!first) sb.Append(',');
            first = false;
            WriteJsonString(sb, key);
            sb.Append(':');
            WriteValue(sb, val);
        }
        sb.Append('}');
    }

    private static void WriteArray(StringBuilder sb, System.Collections.IEnumerable list)
    {
        sb.Append('[');
        var first = true;
        foreach (var item in list)
        {
            if (!first) sb.Append(',');
            first = false;
            WriteValue(sb, item);
        }
        sb.Append(']');
    }

    private static void WriteJsonString(StringBuilder sb, string s)
    {
        sb.Append('"');
        foreach (var c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20)
                    {
                        sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        sb.Append(c);
                    }
                    break;
            }
        }
        sb.Append('"');
    }
}
