import { z } from "zod";

export const LendingStatusEnum = z.enum(["ativo", "devolvido"]);

export const LendingSchema = z.object({
  id: z.string().uuid(),
  material_type_id: z.string().uuid(),
  military_id: z.string().uuid(),
  master_id: z.string().uuid(),
  quantidade: z.number().int().min(1).default(1),
  status: LendingStatusEnum,
  issued_at: z.string().datetime(),
  returned_at: z.string().datetime().nullable(),
  notes: z.string().nullable(),
  material_type: z
    .object({ nome: z.string(), categoria: z.string() })
    .optional(),
  military: z
    .object({ nome_completo: z.string(), matricula: z.string(), posto: z.string() })
    .optional(),
});

export const CreateLendingSchema = z.object({
  material_type_id: z.string().uuid(),
  military_id: z.string().uuid(),
  quantidade: z.number().int().min(1).default(1),
  notes: z.string().optional(),
});

export const ReturnLendingSchema = z.object({
  returned_at: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export type Lending = z.infer<typeof LendingSchema>;
export type CreateLending = z.infer<typeof CreateLendingSchema>;
export type LendingStatus = z.infer<typeof LendingStatusEnum>;
