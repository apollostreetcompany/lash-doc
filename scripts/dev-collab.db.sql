\getenv lash_auth_password POSTGRES_PASSWORD
ALTER ROLE supabase_auth_admin PASSWORD :'lash_auth_password';
