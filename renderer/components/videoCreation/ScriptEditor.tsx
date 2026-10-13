import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'next-i18next';
import type { Scene } from '../../../types/videoProject';
import { Button } from '../ui/button';
import { useNavigationGuard } from '../../context/NavigationGuardContext';
export default function ScriptEditor({
  originalText,
  scriptText,
  expectedVersion,
  onSave,
}: {
  originalText?: string;
  scriptText: string;
  expectedVersion: number;
  onSave: (text: string, version: number) => Promise<unknown>;
}) {
  const { t } = useTranslation('videoCreation');
  const [draft, setDraft] = useState(scriptText);
  const draftVersion = useRef(expectedVersion);
  useEffect(() => {
    if (draft === scriptText) draftVersion.current = expectedVersion;
  }, [draft, scriptText, expectedVersion]);
  let scenes: Scene[] | undefined;
  try {
    const value = JSON.parse(draft);
    if (
      Array.isArray(value) &&
      value.every((s) => typeof s.id === 'string' && Array.isArray(s.dialogues))
    )
      scenes = value;
  } catch {}
  const editScene = (sceneId: string, patch: Partial<Scene>) =>
    setDraft(
      JSON.stringify(
        scenes?.map((scene) =>
          scene.id === sceneId ? { ...scene, ...patch } : scene,
        ),
        null,
        2,
      ),
    );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(draft, draftVersion.current);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  };
  useNavigationGuard('video-script', {
    isDirty: draft !== scriptText,
    onSave: save,
    onDiscard: () => setDraft(scriptText),
  });
  return (
    <section className="space-y-3">
      {originalText && (
        <details open>
          <summary>{t('script.original')}</summary>
          <pre
            data-testid="original-script"
            className="whitespace-pre-wrap rounded bg-muted p-3 text-sm"
          >
            {originalText}
          </pre>
        </details>
      )}
      {scenes?.map((scene, index) => (
        <article className="space-y-2 rounded-lg border p-3" key={scene.id}>
          <h4 className="font-semibold">
            {t('script.scene')} {index + 1}
          </h4>
          <div className="grid gap-2 md:grid-cols-2">
            {(['location', 'time'] as const).map((key) => (
              <label className="text-sm" key={key}>
                {t(`script.${key}`)}
                <input
                  aria-label={t(`script.${key}`)}
                  value={scene[key]}
                  className="mt-1 w-full rounded border bg-background p-2"
                  onChange={(e) =>
                    editScene(scene.id, { [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          {(['action', 'narration', 'sound'] as const).map((key) => (
            <label className="block text-sm" key={key}>
              {t(`script.${key}`)}
              <textarea
                aria-label={t(`script.${key}`)}
                value={scene[key]}
                className="mt-1 w-full rounded border bg-background p-2"
                onChange={(e) => editScene(scene.id, { [key]: e.target.value })}
              />
            </label>
          ))}
          {scene.dialogues.map((line, lineIndex) => (
            <label className="block text-sm" key={line.id}>
              {t('script.dialogue')} · {line.speakerId}
              <textarea
                aria-label={`${t('script.dialogue')} ${lineIndex + 1}`}
                className="mt-1 w-full rounded border bg-background p-2"
                value={line.text}
                onChange={(e) =>
                  editScene(scene.id, {
                    dialogues: scene.dialogues.map((d) =>
                      d.id === line.id ? { ...d, text: e.target.value } : d,
                    ),
                  })
                }
              />
            </label>
          ))}
          <label className="block text-sm">
            {t('storyboard.duration')}
            <input
              type="number"
              min="1"
              value={scene.durationMs / 1000}
              className="ml-2 w-24 rounded border bg-background p-1"
              onChange={(e) =>
                editScene(scene.id, {
                  durationMs: Math.round(Number(e.target.value) * 1000),
                })
              }
            />
          </label>
        </article>
      ))}
      {scenes ? (
        <details>
          <summary>{t('script.advanced')}</summary>
          <textarea
            aria-label={t('script.draft')}
            className="mt-1 min-h-64 w-full rounded border bg-background p-3 font-mono text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </details>
      ) : (
        <label className="block text-sm">
          {t('script.draft')}
          <textarea
            aria-label={t('script.draft')}
            className="mt-1 min-h-64 w-full rounded border bg-background p-3 font-mono text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        {t('script.structuredHint')}
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button
        disabled={saving || draft === scriptText}
        onClick={() => void save().catch(() => {})}
      >
        {t('save')}
      </Button>
    </section>
  );
}
