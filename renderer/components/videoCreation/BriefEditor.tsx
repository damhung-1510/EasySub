import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
import { useNavigationGuard } from '../../context/NavigationGuardContext';
import type { CreativeBriefDraft } from '../../../types/creativeDiscovery';
import type { VideoAction } from './CreativeDiscoveryPanel';
const textFields = [
  'objective',
  'audience',
  'premise',
  'conflict',
  'characters',
  'relationships',
  'world',
  'locations',
  'language',
  'dialogueTone',
  'ending',
  'style',
] as const;
export default function BriefEditor({
  brief,
  onAction,
  busy,
}: {
  brief: CreativeBriefDraft;
  onAction: VideoAction;
  busy: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  const [draft, setDraft] = useState(brief);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(brief);
  const save = async () => {
    setError('');
    try {
      await onAction('update', { patch: { brief: draft } });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  useNavigationGuard('video-brief', {
    isDirty: dirty,
    onSave: save,
    onDiscard: () => setDraft(brief),
  });
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('brief.editHint')}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {textFields.map((key) => (
          <label className="block text-sm" key={key}>
            {t(`brief.${key}`)}
            <textarea
              className="mt-1 w-full rounded border bg-background p-2"
              value={draft[key]}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [key]: e.target.value }))
              }
            />
          </label>
        ))}
      </div>
      {(['assumptions', 'unresolvedIssues'] as const).map((key) => (
        <label className="block text-sm" key={key}>
          {t(`brief.${key}`)}
          <textarea
            className="min-h-24 w-full rounded border bg-background p-2"
            value={draft[key].join('\n')}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                [key]: e.target.value.split('\n').filter(Boolean),
              }))
            }
          />
        </label>
      ))}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          {t('settings.duration')}
          <input
            type="number"
            min="1"
            value={draft.targetDurationMs / 1000}
            className="ml-2 w-24 rounded border bg-background p-1"
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                targetDurationMs: Math.round(Number(e.target.value) * 1000),
              }))
            }
          />
        </label>
        <label className="text-sm">
          {t('brief.audioMode')}
          <select
            className="ml-2 rounded border bg-background p-1"
            value={draft.audioMode}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                audioMode: e.target.value as CreativeBriefDraft['audioMode'],
              }))
            }
          >
            {['narration', 'tts', 'native'].map((m) => (
              <option key={m} value={m}>
                {t(`settings.${m}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={
            busy ||
            !dirty ||
            draft.targetDurationMs <= 0 ||
            !Number.isFinite(draft.targetDurationMs)
          }
          onClick={() => void save().catch(() => {})}
        >
          {t('save')}
        </Button>
        <Button
          disabled={busy || dirty || !!brief.approvedAt}
          onClick={() =>
            void onAction('confirmBrief', {
              draftRevisionId: brief.revisionId,
            }).catch(() => {})
          }
        >
          {brief.approvedAt ? t('brief.approved') : t('brief.confirm')}
        </Button>
      </div>
    </section>
  );
}
