import { z } from "zod";

// Extraído de routes/arsenal.ts pra um módulo próprio sem imports internos
// (só `zod`, um pacote npm) — permite testar o schema de verdade via
// `node --experimental-strip-types --test` sem precisar importar arsenal.ts
// inteiro, que puxa `../middleware/role-guard` e outros caminhos relativos
// sem extensão (funcionam via Bun em runtime, mas o resolver ESM nativo do
// Node exige extensão explícita — por isso os testes existentes deste repo
// que tocam arquivos de rota usam leitura estática de arquivo em vez de
// import direto; aqui, extraindo o schema puro, dá pra importar e testar
// de verdade, com `.safeParse()` real).
//
// Achado ALTO/MÉDIO de code review (revisão do fix de photo_url): SSOT pro
// path de foto de material — antes copiado 3x (aqui 2x + OcorrenciaSchema
// em routes/arsenal.ts) com o mesmo comentário, o que foi exatamente a causa
// do bug original (RequestSchema divergiu de OcorrenciaSchema por não ter
// uma única fonte). `photo_storage_path` agora recebe o MESMO endurecimento
// de `photo_url` (antes só tinha `.optional().nullable()`, sem min/max,
// então aceitava até string vazia — inconsistente com o campo irmão).
// `.refine` bloqueia path traversal (`..`) e injeção de controle/newline —
// não usa `.url()` nem regex fechada por formato exato porque
// `apps/web/src/lib/storage.ts` (`resolvePhotoUrl`) documenta e SUPORTA de
// propósito 2 formatos: path relativo novo ("materials/<uuid>.webp") E URL
// pública legada completa ("https://....supabase.co/storage/v1/object/
// public/material-photos/...") — uma regex fechada rejeitaria dado legado
// legítimo.
export const materialPhotoPathSchema = z.string()
  .min(1)
  .max(500)
  .refine((v) => !v.includes("..") && !/[\r\n\0]/.test(v), { message: "path de foto inválido" });

export const RequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stock_adjustment"),
    material_type_id: z.string().uuid(),
    new_quantity: z.number().int().min(0),
    notes: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal("material_deactivation"),
    material_type_id: z.string().uuid(),
    notes: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal("material_addition"),
    category_id: z.string().uuid().optional().nullable(),
    nome: z.string().min(1).max(200).optional(),
    categoria: z.string().max(120).optional(),
    categoria_slug: z.string().max(120).optional(),
    quantidade_total: z.number().int().min(1).optional(),
    descricao: z.string().max(1000).optional().nullable(),
    calibre: z.string().max(80).optional().nullable(),
    has_serial_numbers: z.boolean().optional(),
    requires_validity: z.boolean().optional(),
    requires_vehicle_fields: z.boolean().optional(),
    validity_alert_days: z.array(z.number().int()).optional().nullable(),
    // Bug real de produção corrigido (achado do usuário: toda solicitação de
    // adição COM foto falhava com ZodError 400, nunca sem foto): photo_url
    // aqui é o path relativo devolvido por POST /api/arsenal/material-photo
    // (bucket privado material-photos, NUNCA uma URL pública — mesmo padrão
    // já documentado em OcorrenciaSchema.foto_url em routes/arsenal.ts),
    // então `z.string().url()` rejeitava 100% dos uploads reais.
    photo_url: materialPhotoPathSchema.optional(),
    photo_storage_path: materialPhotoPathSchema.optional().nullable(),
    vehicle_plate: z.string().max(30).optional().nullable(),
    vehicle_color: z.string().max(80).optional().nullable(),
    vehicle_year: z.number().int().optional().nullable(),
    vehicle_model: z.string().max(120).optional().nullable(),
    items: z.array(z.object({
      numero_serie: z.string().max(120).optional().nullable(),
      validade_item: z.string().optional().nullable(),
      descricao_adicional: z.string().max(1000).optional().nullable(),
      cautela_elegivel: z.boolean().optional().nullable(),
    })).optional(),
    cautela_habilitada: z.boolean().optional(),
    quantidade_cautela: z.number().int().min(0).optional(),
    batch: z.array(z.object({
      category_id: z.string().uuid().optional().nullable(),
      nome: z.string().min(1).max(200),
      categoria: z.string().max(120),
      categoria_slug: z.string().max(120).optional(),
      quantidade_total: z.number().int().min(1),
      descricao: z.string().max(1000).optional().nullable(),
      calibre: z.string().max(80).optional().nullable(),
      has_serial_numbers: z.boolean().optional(),
      requires_validity: z.boolean().optional(),
      requires_vehicle_fields: z.boolean().optional(),
      validity_alert_days: z.array(z.number().int()).optional().nullable(),
      // Mesmo achado do campo de topo acima — path relativo, nunca URL.
      photo_url: materialPhotoPathSchema.optional(),
      photo_storage_path: materialPhotoPathSchema.optional().nullable(),
      vehicle_plate: z.string().max(30).optional().nullable(),
      vehicle_color: z.string().max(80).optional().nullable(),
      vehicle_year: z.number().int().optional().nullable(),
      vehicle_model: z.string().max(120).optional().nullable(),
      items: z.array(z.object({
        numero_serie: z.string().max(120).optional().nullable(),
        validade_item: z.string().optional().nullable(),
        descricao_adicional: z.string().max(1000).optional().nullable(),
        cautela_elegivel: z.boolean().optional().nullable(),
      })).optional(),
      cautela_habilitada: z.boolean().optional(),
      quantidade_cautela: z.number().int().min(0).optional(),
    })).optional(),
    notes: z.string().max(500).optional(),
  }),
]);
