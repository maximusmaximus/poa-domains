// Optional escrow policy and write-only Worker secrets. None have live defaults.
interface __BaseEnv_Env {
  POA_ESCROW_KEY?: string;
  ESCROW_ADMIN_TOKEN?: string;
  POA_ESCROW_ADDRESS?: string;
  POA_ESCROW_ENGINE_SHA256?: string;
  POA_ESCROW_PARAMS_SHA256?: string;
  POA_ESCROW_PER_TX?: string;
  POA_ESCROW_DAILY?: string;
}
