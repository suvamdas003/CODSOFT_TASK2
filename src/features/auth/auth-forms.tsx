"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/display";
import { Field, fieldAria, Input } from "@/components/ui/form-controls";
import { authClient } from "@/lib/auth/auth-client";
import { loginSchema, registerSchema, safeNextPath, type LoginInput, type RegisterInput } from "@/lib/validation/auth";

function authErrorMessage(error: { status?: number; message?: string } | null | undefined, fallback: string) {
  if (!error) return fallback;
  if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
  return fallback;
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { error: signInError } = await authClient.signIn.email({ email: values.email, password: values.password });
    if (signInError) {
      // Same message for unknown email, wrong password or disabled account.
      setError(authErrorMessage(signInError, "Incorrect email or password, or the account is disabled."));
      return;
    }
    router.push(safeNextPath(next) ?? "/post-login");
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label="Email" htmlFor="email" error={errors.email?.message} required>
        <Input {...fieldAria("email", errors.email?.message)} type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password?.message} required>
        <Input
          {...fieldAria("password", errors.password?.message)}
          type="password"
          autoComplete="current-password"
          {...form.register("password")}
        />
      </Field>
      <Button type="submit" className="w-full" size="lg" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-stone-600">
        New here?{" "}
        <Link
          href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}
          className="text-brand-700 font-medium hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { error: signUpError } = await authClient.signUp.email({ name: values.name, email: values.email, password: values.password });
    if (signUpError) {
      setError(
        authErrorMessage(
          signUpError,
          signUpError.status === 422 || signUpError.status === 400
            ? "We couldn't create an account with those details. If you already have an account, sign in instead."
            : "Sign-up failed. Please try again.",
        ),
      );
      return;
    }
    router.push(safeNextPath(next) ?? "/menu");
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label="Full name" htmlFor="name" error={errors.name?.message} required>
        <Input {...fieldAria("name", errors.name?.message)} autoComplete="name" {...form.register("name")} />
      </Field>
      <Field label="Email" htmlFor="email" error={errors.email?.message} required>
        <Input {...fieldAria("email", errors.email?.message)} type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password?.message} hint="At least 10 characters." required>
        <Input
          {...fieldAria("password", errors.password?.message)}
          type="password"
          autoComplete="new-password"
          {...form.register("password")}
        />
      </Field>
      <Field label="Confirm password" htmlFor="confirmPassword" error={errors.confirmPassword?.message} required>
        <Input
          {...fieldAria("confirmPassword", errors.confirmPassword?.message)}
          type="password"
          autoComplete="new-password"
          {...form.register("confirmPassword")}
        />
      </Field>
      <Button type="submit" className="w-full" size="lg" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-stone-600">
        Already have an account?{" "}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-brand-700 font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
