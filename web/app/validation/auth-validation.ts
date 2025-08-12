import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(6, "At least 6 characters"),
});

export type Credentials = z.infer<typeof credentialsSchema>;