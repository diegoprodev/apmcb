import bcrypt from "bcryptjs";
import type { Pool } from "pg";
import { type AuthProvider, type AuthIdentity, AuthError } from "./auth-provider.ts";

export interface UsuariosRepository {
  findByEmail(email: string): Promise<{ id: string; email: string; senha_hash: string } | null>;
}

export class PgUsuariosRepository implements UsuariosRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async findByEmail(email: string) {
    const { rows } = await this.pool.query<{ id: string; email: string; senha_hash: string }>(
      "SELECT id, email, senha_hash FROM public.usuarios WHERE lower(email) = lower($1)",
      [email],
    );
    return rows[0] ?? null;
  }
}

export class LocalAuthProvider implements AuthProvider {
  private readonly repo: UsuariosRepository;

  constructor(repo: UsuariosRepository) {
    this.repo = repo;
  }

  async login(email: string, password: string): Promise<AuthIdentity> {
    const user = await this.repo.findByEmail(email);
    // Mesma mensagem/código tanto pra "usuário não existe" quanto pra "senha
    // errada" — evita user enumeration (Review Focus deste plano).
    if (!user) {
      throw new AuthError("Credenciais inválidas", "invalid_credentials");
    }
    const matches = await bcrypt.compare(password, user.senha_hash);
    if (!matches) {
      throw new AuthError("Credenciais inválidas", "invalid_credentials");
    }
    return { userId: user.id, email: user.email };
  }

  async verifyAccessToken(_token: string): Promise<AuthIdentity> {
    // O fallback "Authorization: Bearer <token>" (apps/bff/src/middleware/auth.ts)
    // existe hoje só pra validar um JWT da Supabase Auth — não há equivalente
    // no modo ON_PREMISE nesta fase. Ver Task 6 deste plano: o middleware
    // trata este erro devolvendo 501, nunca deixa a exceção subir sem tratamento.
    throw new AuthError(
      "Autenticação via Bearer token não é suportada no modo ON_PREMISE",
      "not_supported",
    );
  }
}
