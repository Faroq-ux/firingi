"use client";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

/** Browser-side auth client (sign-in / sign-out, two-factor). Same-origin, so no baseURL needed. */
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
