export interface AuthIdentity {
  userId: string;
  email: string | null;
  accessToken?: string;
}

export class AuthError extends Error {
  public code: "invalid_credentials" | "invalid_token" | "not_supported";

  constructor(
    message: string,
    code: "invalid_credentials" | "invalid_token" | "not_supported",
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface AuthProvider {
  login(email: string, password: string): Promise<AuthIdentity>;
  verifyAccessToken(token: string): Promise<AuthIdentity>;
}

export class SupabaseAuthProvider implements AuthProvider {
  private readonly url: string;
  private readonly serviceRoleKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { url: string; serviceRoleKey: string; fetchImpl?: typeof fetch }) {
    this.url = opts.url;
    this.serviceRoleKey = opts.serviceRoleKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async login(email: string, password: string): Promise<AuthIdentity> {
    const res = await this.fetchImpl(`${this.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.serviceRoleKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = (await res.json()) as {
      access_token?: string;
      user?: { id: string; email?: string };
    };
    if (!res.ok || !data.access_token || !data.user) {
      throw new AuthError("Credenciais inválidas", "invalid_credentials");
    }
    return { userId: data.user.id, email: data.user.email ?? null, accessToken: data.access_token };
  }

  async verifyAccessToken(token: string): Promise<AuthIdentity> {
    const res = await this.fetchImpl(`${this.url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: this.serviceRoleKey },
    });
    if (!res.ok) {
      throw new AuthError("Token inválido ou expirado", "invalid_token");
    }
    const user = (await res.json()) as { id: string; email?: string } | null;
    if (!user?.id) {
      throw new AuthError("Token inválido ou expirado", "invalid_token");
    }
    return { userId: user.id, email: user.email ?? null };
  }
}
