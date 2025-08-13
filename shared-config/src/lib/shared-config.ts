import { z } from 'zod';

export const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().default(3000),
  NEO4J_URL: z.url(),
  NEO4J_USER: z.string(),
  NEO4J_PASSWORD: z.string(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function loadServerEnv(): ServerEnv {
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(z.treeifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}