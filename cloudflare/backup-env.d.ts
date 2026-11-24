// Secrets/local-only vars used by registry backups and profile IPFS pinning (not in wrangler.jsonc vars).
interface __BaseEnv_Env {
  BACKUP_ADMIN_TOKEN?: string;
  BACKUP_RESTORE_ENABLED?: string;
  PINATA_JWT?: string;
  PINATA_API_URL?: string;
}
