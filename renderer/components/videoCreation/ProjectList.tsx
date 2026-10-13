import React, { useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type { ProjectSummary, ProjectDraft } from '../../../types/videoProject';
export default function ProjectList({
  projects,
  onSelect,
  onCreate,
  busy,
}: {
  projects: ProjectSummary[];
  onSelect: (id: string) => void;
  onCreate: (draft: ProjectDraft) => unknown;
  busy: boolean;
}) {
  const { t } = useTranslation('videoCreation');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'single' | 'series'>('single');
  const [idea, setIdea] = useState('');
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <div className="grid gap-2 md:grid-cols-2">
        {projects.map((p) => (
          <button
            type="button"
            key={p.id}
            className="rounded-lg border p-4 text-left hover:bg-accent"
            onClick={() => onSelect(p.id)}
          >
            <strong>{p.name}</strong>
            <p className="text-sm text-muted-foreground">
              {t(`project.${p.kind}`)} · {p.episodeCount}{' '}
              {t('project.episodes')}
            </p>
            {p.recoverableError && (
              <p className="text-destructive">{p.recoverableError}</p>
            )}
          </button>
        ))}
      </div>
      <form
        className="max-w-xl space-y-3 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({ name, kind, idea });
        }}
      >
        <h2 className="font-semibold">{t('project.new')}</h2>
        <label className="block">
          {t('project.name')}
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          {t('project.type')}
          <select
            className="block w-full rounded border bg-background p-2"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'single' | 'series')}
          >
            <option value="single">{t('project.single')}</option>
            <option value="series">{t('project.series')}</option>
          </select>
        </label>
        <label className="block">
          {t('project.idea')}
          <textarea
            className="min-h-24 w-full rounded border bg-background p-2"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
          />
        </label>
        <Button disabled={busy || !name.trim()} type="submit">
          {t('project.create')}
        </Button>
      </form>
    </section>
  );
}
