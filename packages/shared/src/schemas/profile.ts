import { z } from "zod";

export const PostoEnum = z.enum([
  "cadete",
  "aspirante",
  "segundo_tenente",
  "primeiro_tenente",
  "capitao",
  "major",
  "tenente_coronel",
  "coronel",
]);

export const RoleEnum = z.enum(["admin", "master", "usuario"]);

export const RegistrationStatusEnum = z.enum([
  "pending_biometric",
  "complete",
  "inactive",
  "impedimento_administrativo",
]);

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  matricula: z.string().min(1).max(20),
  nome_completo: z.string().min(2).max(120),
  posto: PostoEnum,
  turma: z.string().max(20).nullable(),
  foto_url: z.string().url().nullable(),
  role: RoleEnum,
  registration_status: RegistrationStatusEnum,
  created_by: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateProfileSchema = ProfileSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  foto_url: true,
}).extend({
  temp_password: z.string().min(8).optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type CreateProfile = z.infer<typeof CreateProfileSchema>;
export type Posto = z.infer<typeof PostoEnum>;
export type Role = z.infer<typeof RoleEnum>;
export type RegistrationStatus = z.infer<typeof RegistrationStatusEnum>;
