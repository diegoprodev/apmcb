import { z } from "zod";

export const MaterialCategoryEnum = z.enum([
  "arma",
  "farda",
  "acessorio",
  "equipamento",
]);

export const MaterialTypeSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().min(1).max(100),
  categoria: MaterialCategoryEnum,
  quantidade_total: z.number().int().min(0),
  descricao: z.string().nullable(),
  ativo: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateMaterialTypeSchema = MaterialTypeSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type MaterialType = z.infer<typeof MaterialTypeSchema>;
export type CreateMaterialType = z.infer<typeof CreateMaterialTypeSchema>;
export type MaterialCategory = z.infer<typeof MaterialCategoryEnum>;
