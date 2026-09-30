// Serialização JSON determinística para hash de conteúdo (R-01A).
//
// Regras:
//  - chaves de objeto ordenadas em TODOS os níveis, por unidade de código
//    UTF-16 (Array.prototype.sort padrão — independe de locale);
//  - arrays preservam a ordem;
//  - primitivos serializados como no JSON.stringify;
//  - toJSON() é respeitado (Date vira string ISO), como no JSON.stringify;
//  - propriedade com valor undefined é omitida (mesma semântica do JSON).
//
// Diferente do JSON.stringify, FALHA (em vez de colapsar em silêncio) para
// entradas que gerariam colisão: número não finito (viraria null), undefined/
// função/symbol ou buraco dentro de array (viraria null), Date inválida
// (viraria null), bigint, objeto não-plano sem toJSON (Map/Set virariam {}),
// referência circular e aninhamento acima de MAX_DEPTH (evita estouro de
// pilha com payload de cliente).
//
// Não é uma implementação certificada da RFC 8785 (JCS): a ordenação de chaves
// e a formatação de números coincidem com o JCS para valores comuns, mas não
// há validação de I-JSON nem suíte de conformidade. Não alegar conformidade.

const MAX_DEPTH = 64;

export function canonicalJson(value: unknown): string {
  return serialize(value, new Set<object>(), "$");
}

function serialize(value: unknown, ancestors: Set<object>, path: string): string {
  if (ancestors.size > MAX_DEPTH) {
    throw new TypeError(`canonicalJson: profundidade acima de ${MAX_DEPTH} em ${path}`);
  }
  if (value instanceof Date && Number.isNaN(value.getTime())) {
    throw new TypeError(`canonicalJson: Date inválida em ${path}`);
  }
  if (value !== null && typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    value = (value as { toJSON: (key: string) => unknown }).toJSON("");
  }

  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: número não finito em ${path}`);
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonicalJson: valor não serializável (${typeof value}) em ${path}`);
  }

  const obj = value as object;
  if (ancestors.has(obj)) throw new TypeError(`canonicalJson: referência circular em ${path}`);
  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) {
      const items: string[] = [];
      for (let i = 0; i < obj.length; i++) {
        if (!(i in obj)) throw new TypeError(`canonicalJson: array esparso em ${path}[${i}]`);
        items.push(serialize(obj[i], ancestors, `${path}[${i}]`));
      }
      return `[${items.join(",")}]`;
    }
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`canonicalJson: objeto não-plano em ${path}`);
    }
    const record = obj as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${serialize(record[key], ancestors, `${path}.${key}`)}`);
    }
    return `{${parts.join(",")}}`;
  } finally {
    ancestors.delete(obj);
  }
}
