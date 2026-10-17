"use client";

import { createAuthClient } from "better-auth/react";

/** Browser-side auth client (same origin). */
export const authClient = createAuthClient();
