// Secrets/local-only vars used by registry backups, IPFS pinning, and GitHub feedback (not in wrangler.jsonc vars).
interface __BaseEnv_Env {
  BACKUP_ADMIN_TOKEN?: string;
  BACKUP_RESTORE_ENABLED?: string;
  PINATA_JWT?: string;
  PINATA_API_URL?: string;
  FEEDBACK_GITHUB_TOKEN?: string;
  FEEDBACK_GITHUB_REPO?: string;
}
