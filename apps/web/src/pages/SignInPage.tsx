import { zodResolver } from '@hookform/resolvers/zod';
import { signInCodeSchema, signInEmailSchema } from '@mecatol/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import type { z } from 'zod';
import { fetchMe } from '../api.js';
import { sendSignInCode, signInWithCode } from '../auth.js';
import { DisplayNameForm } from '../components/DisplayNameForm.js';
import { buttonClass, Field, FormError, linkButtonClass } from '../components/form.js';
import { ME_QUERY_KEY, useMe } from '../useMe.js';

type EmailForm = z.input<typeof signInEmailSchema>;
type CodeForm = z.input<typeof signInCodeSchema>;

/** Only same-site paths, so `?next=` can't send people elsewhere. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function SignInPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const [email, setEmail] = useState<string | null>(null);
  const [needsName, setNeedsName] = useState(false);

  if (me.data && !needsName) {
    return <Navigate to={me.data.displayName ? next : '/account'} replace />;
  }

  return (
    <section className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">{needsName ? 'Welcome!' : 'Sign in'}</h1>
      {needsName ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">Pick a display name to finish setting up your account.</p>
          <DisplayNameForm initial={null} submitLabel="Continue" onSaved={() => void navigate(next, { replace: true })} />
        </>
      ) : email === null ? (
        <EmailStep onSent={setEmail} />
      ) : (
        <CodeStep
          email={email}
          onBack={() => setEmail(null)}
          onSignedIn={async () => {
            const user = await queryClient.fetchQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe });
            if (user && !user.displayName) setNeedsName(true);
            else void navigate(next, { replace: true });
          }}
        />
      )}
    </section>
  );
}

function EmailStep({ onSent }: { onSent: (email: string) => void }) {
  const form = useForm<EmailForm>({ resolver: zodResolver(signInEmailSchema), defaultValues: { email: '' } });
  const [error, setError] = useState<string | null>(null);

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    const { email } = signInEmailSchema.parse(values);
    try {
      await sendSignInCode(email);
      onSent(email);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the code');
    }
  });

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        We'll email you a 6-digit code. No password needed. New here? This creates your account.
      </p>
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        autoFocus
        error={form.formState.errors.email?.message}
        {...form.register('email')}
      />
      <FormError message={error} />
      <button type="submit" className={buttonClass} disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Sending…' : 'Email me a code'}
      </button>
    </form>
  );
}

function CodeStep({ email, onBack, onSignedIn }: { email: string; onBack: () => void; onSignedIn: () => Promise<void> }) {
  const form = useForm<CodeForm>({ resolver: zodResolver(signInCodeSchema), defaultValues: { otp: '' } });
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  useEffect(() => form.setFocus('otp'), [form]);

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await signInWithCode(email, signInCodeSchema.parse(values).otp);
      await onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code is wrong or has expired');
    }
  });

  const resend = async () => {
    setError(null);
    setResent(false);
    try {
      await sendSignInCode(email);
      setResent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the code');
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        We sent a code to <strong>{email}</strong>. It expires in 10 minutes.
      </p>
      <Field
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        error={form.formState.errors.otp?.message}
        {...form.register('otp')}
      />
      <FormError message={error} />
      {resent && <p className="text-sm text-green-700">A new code is on its way.</p>}
      <div className="flex items-center gap-4">
        <button type="submit" className={buttonClass} disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className={linkButtonClass} onClick={() => void resend()}>
          Resend code
        </button>
        <button type="button" className={linkButtonClass} onClick={onBack}>
          Use another email
        </button>
      </div>
    </form>
  );
}
