/** Private loopback RPC names shared by the Host and browser halves. */
export const IMAGEN_RPC_CHANNEL = '/dsh-imagen'

/** Versioned endpoints: live progress, durable image reads, model listing. */
export const IMAGEN_RPC_ENDPOINT = {
  progress: 'imagen/progress',
  image: 'imagen/image',
  models: 'imagen/models',
} as const
