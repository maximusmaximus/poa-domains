// Secrets/local-only vars used by registry backups (not in wrangler.jsonc vars).
interface __BaseEnv_Env {
  BACKUP_ADMIN_TOKEN?: string;
  BACKUP_RESTORE_ENABLED?: string;
}
