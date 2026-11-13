// Optional escrow policy and write-only Worker secrets. None have live defaults.
interface __BaseEnv_Env {
  POA_ESCROW_KEY?: string;
  ESCROW_ADMIN_TOKEN?: string;
  /** PoA account API token for authenticated minepoa.com chain reads/submits. Secret; header only. */
  POA_API_TOKEN?: string;
  POA_ESCROW_ADDRESS?: string;
  POA_ESCROW_ENGINE_SHA256?: string;
  POA_ESCROW_PARAMS_SHA256?: string;
  /** POA new-name checkout; live value approved-v1 turns it on, any other value is off. */
  POA_ESCROW_NEW_NAMES?: string;
  POA_ESCROW_PER_TX?: string;
  POA_ESCROW_DAILY?: string;
}
