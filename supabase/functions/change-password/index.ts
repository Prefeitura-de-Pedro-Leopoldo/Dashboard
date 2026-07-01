// Edge Function: change-password (entry). Equivalente ao POST /api/change-password.
// Liga o banco (getUser + setPassword) via supabase-js (SERVICE_ROLE).
//   supabase functions deploy change-password --project-ref gbtbkviprqnblgdwkaxk --no-verify-jwt
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleChangePassword } from "./handler.ts";
import type { AppUser } from "../login/handler.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const getUser = async (email: string): Promise<AppUser | null> => {
  const { data, error } = await supabase
    .from("app_users")
    .select("email, name, password_hash, role, active, must_change_password, evento_id")
    .ilike("email", email)
    .limit(1);
  if (error) throw error;
  return (data && (data[0] as AppUser)) || null;
};

const setPassword = async (email: string, hash: string): Promise<void> => {
  const { error } = await supabase
    .from("app_users")
    .update({ password_hash: hash, must_change_password: false, updated_at: new Date().toISOString() })
    .ilike("email", email);
  if (error) throw error;
};

Deno.serve((req) => handleChangePassword(req, { getUser, setPassword }));
