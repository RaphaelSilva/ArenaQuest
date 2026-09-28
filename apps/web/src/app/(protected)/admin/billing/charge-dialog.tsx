'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Input } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { AdminEventAudience } from '@web/lib/admin-events-api';
import type { AdminGroup } from '@web/lib/admin-groups-api';
import type {
  BillingEventPrice,
  BillingReportCurrency,
  IssueEventChargesInput,
  IssueEventChargesResult,
} from '@web/lib/admin-billing-api';
import { useMoneyFormatter } from './money';
import { explain } from './explain-error';
import { toMinorUnits } from './minor-units';

/** The API accepts 1–200 user ids per request. */
const MAX_USERS = 200;

/** A person the dialog can select. */
export type ChargeablePerson = { id: string; name: string; email: string };

/** The event being charged — only what the dialog reads. */
export type ChargeableEvent = { id: string; title: string; audience: AdminEventAudience };

type AudienceState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'checked'; outside: ReadonlySet<string> }
  | { state: 'error' };

/**
 * Charge participants for one published event — RFC 0015 §7, §8.
 *
 * One request carries every selected user id. The server is idempotent: a
 * person already charged for this event is reported under `absorbed` and never
 * charged twice, so the result is read back from the response rather than
 * predicted here.
 *
 * **The audience warning never blocks.** For a `restricted` event the dialog
 * asks the read-only audience check who among the selection the event is not
 * addressed to and flags each of them inline, in words, with a link to the
 * event's audience. Submitting stays allowed (Resolved #7): a charge grants no
 * access and writes no audience row, and fixing the audience is a decision the
 * administrator takes in the events backoffice.
 *
 * Group expansion is client-side: a group adds its current members to the
 * selection, and the request still carries user ids only.
 */
export function ChargeDialog({
  event,
  price,
  currency,
  people,
  onClose,
  onCharged,
}: {
  event: ChargeableEvent;
  price: BillingEventPrice | null;
  currency: BillingReportCurrency | null;
  people: readonly ChargeablePerson[];
  onClose: () => void;
  /** Called after the server answered, so the caller can refresh its list. */
  onCharged: (result: IssueEventChargesResult) => void;
}) {
  const dict = useDict();
  const d = dict.admin.billing.extras.dialog;
  const planValidation = dict.admin.billing.plans.validation;
  const client = useApiClient();
  const formatMoneyValue = useMoneyFormatter(currency);

  const titleId = useId();
  const searchId = useId();
  const groupId = useId();
  const noteId = useId();
  const noteErrorId = useId();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  /** People the dialog learned about itself: group members and new users. */
  const [added, setAdded] = useState<ChargeablePerson[]>([]);

  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [groupChoice, setGroupChoice] = useState('');
  const [groupNotice, setGroupNotice] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createNotice, setCreateNotice] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const [audience, setAudience] = useState<AudienceState>({ state: 'idle' });

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IssueEventChargesResult | null>(null);

  const exponent = currency?.exponent ?? null;
  const code = price?.currency ?? currency?.code ?? '';

  const everyone = useMemo(() => {
    const byId = new Map<string, ChargeablePerson>();
    for (const person of people) byId.set(person.id, person);
    for (const person of added) if (!byId.has(person.id)) byId.set(person.id, person);
    return byId;
  }, [people, added]);

  const nameOf = (userId: string) => everyone.get(userId)?.name ?? userId;

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = [...everyone.values()];
    if (!needle) return all;
    return all.filter(
      (person) =>
        person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle),
    );
  }, [everyone, search]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await client.adminGroups.list();
        if (!cancelled) setGroups(list);
      } catch {
        if (!cancelled) setGroupError(d.groupsError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, d.groupsError]);

  /**
   * The audience check, re-asked whenever the selection changes. Read-only on
   * the server; public and members events are never checked (always empty).
   */
  const selectionKey = selected.join(',');
  useEffect(() => {
    if (event.audience !== 'restricted' || selectionKey === '') {
      setAudience({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setAudience({ state: 'checking' });
    void (async () => {
      try {
        const check = await client.adminBilling.extras.audienceCheck(
          event.id,
          selectionKey.split(','),
        );
        if (!cancelled) setAudience({ state: 'checked', outside: new Set(check.outsideAudience) });
      } catch {
        if (!cancelled) setAudience({ state: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, event.audience, event.id, selectionKey]);

  const outside = audience.state === 'checked' ? audience.outside : new Set<string>();
  const outsideSelected = selected.filter((id) => outside.has(id));

  const toggle = (userId: string) => {
    setFieldError(null);
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const selectMany = (ids: string[]) => {
    setFieldError(null);
    setSelected((current) => [...current, ...ids.filter((id) => !current.includes(id))]);
  };

  const addGroup = async () => {
    const group = groups.find((row) => row.id === groupChoice);
    if (!group) return;
    setGroupNotice(null);
    setGroupError(null);
    try {
      const members = await client.adminGroups.listMembers(group.id);
      setAdded((current) => [
        ...current,
        ...members.map((member) => ({
          id: member.userId,
          name: member.name,
          email: member.email,
        })),
      ]);
      selectMany(members.map((member) => member.userId));
      setGroupNotice(d.groupAdded(members.length, group.name));
    } catch {
      setGroupError(d.groupMembersError);
    }
  };

  const createUser = async () => {
    const name = newName.trim();
    const email = newEmail.trim();
    if (!name || !email || !newPassword) {
      setCreateError(d.createUser.required);
      return;
    }
    setCreateError(null);
    try {
      const user = await client.adminUsers.create({ name, email, password: newPassword });
      setAdded((current) => [...current, { id: user.id, name: user.name, email: user.email }]);
      selectMany([user.id]);
      setCreateNotice(d.createUser.created(user.name));
      setCreateOpen(false);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
    } catch {
      setCreateError(d.createUser.error);
    }
  };

  const submit = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    setFieldError(null);
    setNoteError(null);
    setSubmitError(null);

    if (selected.length === 0) {
      setFieldError(d.validation.noSelection);
      return;
    }
    if (selected.length > MAX_USERS) {
      setFieldError(d.validation.tooMany);
      return;
    }

    let amountMinor: number | undefined;
    if (amount.trim() !== '') {
      if (exponent === null) {
        setFieldError(dict.admin.billing.money.resolveError);
        return;
      }
      const converted = toMinorUnits(amount, exponent);
      if (!converted.ok) {
        const messages: Record<typeof converted.reason, string> = {
          empty: planValidation.amountEmpty,
          'not-a-number': planValidation.amountNotANumber,
          negative: planValidation.amountNegative,
          'too-precise': planValidation.amountTooPrecise(exponent),
        };
        setFieldError(messages[converted.reason]);
        return;
      }
      amountMinor = converted.amountMinor;
    } else if (!price) {
      setFieldError(d.validation.amountRequired);
      return;
    }

    // Negotiated: an explicit amount that is not the price (or with no price at
    // all). The server refuses one without a note; the form says so first.
    const negotiated = amountMinor !== undefined && (!price || amountMinor !== price.amountMinor);
    const trimmedNote = note.trim();
    if (negotiated && !trimmedNote) {
      setNoteError(d.validation.noteRequired);
      return;
    }

    const payload: IssueEventChargesInput = {
      eventId: event.id,
      userIds: selected,
      ...(amountMinor !== undefined ? { amountMinor } : {}),
      ...(trimmedNote ? { termsNote: trimmedNote } : {}),
    };

    setBusy(true);
    try {
      const response = await client.adminBilling.extras.issueCharges(payload);
      setResult(response);
      onCharged(response);
    } catch (thrown) {
      setSubmitError(explain(thrown, d.submitError));
    } finally {
      setBusy(false);
    }
  };

  const eventLink = `/admin/events/${event.id}`;

  const resultGroup = (heading: string, ids: string[]) => (
    <section className="space-y-1">
      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{heading}</h4>
      {ids.length === 0 ? (
        <p className="text-sm text-zinc-500">{d.result.none}</p>
      ) : (
        <ul className="list-inside list-disc text-sm text-zinc-700 dark:text-zinc-300">
          {ids.map((id) => (
            <li key={id}>{nameOf(id)}</li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === 'Escape') onClose();
      }}
    >
      <div className="my-8 w-full max-w-2xl space-y-4 rounded-lg border border-zinc-200 bg-white p-5 md:p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="space-y-2">
          <h2 id={titleId} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {d.title(event.title)}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.explainer}</p>
        </div>

        {result ? (
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {d.result.heading}
            </h3>
            <p role="status" className="text-sm text-zinc-700 dark:text-zinc-300">
              {d.success(result.created.length, result.absorbed.length)}
            </p>
            {resultGroup(
              d.result.created(result.created.length),
              result.created.map((charge) => charge.userId),
            )}
            {resultGroup(
              d.result.absorbed(result.absorbed.length),
              result.absorbed.map((pair) => pair.userId),
            )}
            {resultGroup(d.result.outsideAudience(result.outsideAudience.length), result.outsideAudience)}
            {result.outsideAudience.length > 0 && (
              <Link
                href={eventLink}
                className="inline-block text-sm font-medium text-indigo-600 underline dark:text-indigo-400"
              >
                {d.audienceLink}
              </Link>
            )}
            <div className="flex justify-end">
              <Button type="button" variant="primary" size="md" onClick={onClose}>
                {d.close}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {/* -------------------------------------------------------------
                Who to charge: search + checkboxes, keyboard-native.
                ------------------------------------------------------------- */}
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                {d.peopleLegend}
              </legend>
              <Input
                id={searchId}
                label={d.searchLabel}
                placeholder={d.searchPlaceholder}
                value={search}
                onChange={(changeEvent) => setSearch(changeEvent.target.value)}
              />
              {matches.length === 0 ? (
                <p className="text-sm text-zinc-500">{d.noMatch}</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                  {matches.map((person) => (
                    <li key={person.id}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-900 dark:text-zinc-100">
                        <input
                          type="checkbox"
                          checked={selected.includes(person.id)}
                          onChange={() => toggle(person.id)}
                        />
                        <span className="min-w-0 truncate">
                          {person.name}
                          <span className="ml-2 text-xs text-zinc-500">{person.email}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>

            {/* Group expansion: adds the group's current members. */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label
                  htmlFor={groupId}
                  className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]"
                >
                  {d.groupLabel}
                </label>
                <select
                  id={groupId}
                  value={groupChoice}
                  onChange={(changeEvent) => setGroupChoice(changeEvent.target.value)}
                  className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  <option value="">{d.groupPlaceholder}</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={!groupChoice}
                onClick={() => void addGroup()}
              >
                {d.groupAdd}
              </Button>
            </div>
            {groupNotice && (
              <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
                {groupNotice}
              </p>
            )}
            {groupError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {groupError}
              </p>
            )}

            {/* Create-user shortcut, for a lead with no account yet. */}
            {createOpen ? (
              <section className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {d.createUser.heading}
                </h3>
                <Input
                  label={d.createUser.nameLabel}
                  value={newName}
                  onChange={(changeEvent) => setNewName(changeEvent.target.value)}
                />
                <Input
                  label={d.createUser.emailLabel}
                  type="email"
                  value={newEmail}
                  onChange={(changeEvent) => setNewEmail(changeEvent.target.value)}
                />
                <Input
                  label={d.createUser.passwordLabel}
                  type="password"
                  value={newPassword}
                  helperText={d.createUser.passwordHelp}
                  onChange={(changeEvent) => setNewPassword(changeEvent.target.value)}
                />
                {createError && (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {createError}
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setCreateOpen(false);
                      setCreateError(null);
                    }}
                  >
                    {d.createUser.cancel}
                  </Button>
                  <Button type="button" variant="primary" size="sm" onClick={() => void createUser()}>
                    {d.createUser.submit}
                  </Button>
                </div>
              </section>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCreateNotice(null);
                  setCreateOpen(true);
                }}
              >
                {d.createUser.toggle}
              </Button>
            )}
            {createNotice && (
              <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
                {createNotice}
              </p>
            )}

            {/* -------------------------------------------------------------
                The selection, with the audience warning inline per person.
                ------------------------------------------------------------- */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {d.selectedHeading(selected.length)}
              </h3>
              <div aria-live="polite" className="space-y-1">
                {audience.state === 'checking' && (
                  <p className="text-xs text-zinc-500">{d.audienceChecking}</p>
                )}
                {audience.state === 'error' && (
                  <p className="text-sm text-amber-800 dark:text-amber-300">{d.audienceError}</p>
                )}
                {outsideSelected.length > 0 && (
                  <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                    {d.audienceSummary(outsideSelected.length)}
                  </p>
                )}
              </div>
              {selected.length === 0 ? (
                <p className="text-sm text-zinc-500">{d.selectedEmpty}</p>
              ) : (
                <ul className="space-y-1">
                  {selected.map((userId) => {
                    const name = nameOf(userId);
                    const isOutside = outside.has(userId);
                    return (
                      <li
                        key={userId}
                        data-testid={`selected-${userId}`}
                        className={`rounded-md border px-3 py-2 text-sm ${
                          isOutside
                            ? 'border-amber-400 dark:border-amber-600'
                            : 'border-zinc-200 dark:border-zinc-800'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">{name}</span>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => toggle(userId)}
                            aria-label={d.remove(name)}
                          >
                            <span aria-hidden="true">{'×'}</span>
                          </Button>
                        </div>
                        {isOutside && (
                          <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">
                            {d.audienceWarning}{' '}
                            <Link href={eventLink} className="font-medium underline">
                              {d.audienceLink}
                            </Link>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* -------------------------------------------------------------
                Amount override and the note it demands when negotiated.
                ------------------------------------------------------------- */}
            <Input
              label={d.amountLabel(code)}
              value={amount}
              inputMode="decimal"
              onChange={(changeEvent) => setAmount(changeEvent.target.value)}
              helperText={
                price
                  ? d.amountHelpPrice(formatMoneyValue(price.amountMinor, price.currency))
                  : d.amountHelpNoPrice
              }
            />
            <label className="block" htmlFor={noteId}>
              <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text2)]">
                {d.noteLabel}
              </span>
              <textarea
                id={noteId}
                value={note}
                onChange={(changeEvent) => setNote(changeEvent.target.value)}
                rows={2}
                placeholder={d.notePlaceholder}
                aria-describedby={noteError ? noteErrorId : undefined}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            {noteError && (
              <p id={noteErrorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
                {noteError}
              </p>
            )}

            {fieldError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {fieldError}
              </p>
            )}
            {submitError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {submitError}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" size="md" onClick={onClose}>
                {d.cancel}
              </Button>
              {/* Never disabled by the audience warning — only while sending. */}
              <Button type="submit" variant="primary" size="md" disabled={busy}>
                {d.submit}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
