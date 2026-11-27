import { zodResolver } from '@hookform/resolvers/zod';
import { DISPLAY_NAME_MAX, updateMeSchema, type UpdateMe } from '@mecatol/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { updateMe } from '../api.js';
import { ME_QUERY_KEY } from '../useMe.js';
import { buttonClass, Field, FormError } from './form.js';

export function DisplayNameForm({
  initial,
  submitLabel = 'Save',
  onSaved,
}: {
  initial: string | null;
  submitLabel?: string;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<UpdateMe>({
    resolver: zodResolver(updateMeSchema),
    defaultValues: { displayName: initial ?? '' },
  });
  const save = useMutation({
    mutationFn: updateMe,
    onSuccess: (me) => {
      queryClient.setQueryData(ME_QUERY_KEY, me);
      form.reset({ displayName: me.displayName ?? '' });
      onSaved?.();
    },
  });

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      <Field
        label="Display name"
        autoComplete="nickname"
        maxLength={DISPLAY_NAME_MAX}
        hint="Shown on games you log. This is separate from player names in games."
        error={form.formState.errors.displayName?.message}
        {...form.register('displayName')}
      />
      <FormError message={save.error?.message ?? null} />
      <button type="submit" className={buttonClass} disabled={save.isPending}>
        {save.isPending ? 'Saving…' : submitLabel}
      </button>
      {save.isSuccess && !form.formState.isDirty && !onSaved && <span className="ml-3 text-sm text-green-700">Saved.</span>}
    </form>
  );
}
