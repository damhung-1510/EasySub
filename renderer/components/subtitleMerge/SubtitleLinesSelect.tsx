/**
 * Which block of a bilingual subtitle to show: both lines, only the source or only the
 * translation. Hidden for subtitles that are not bilingual.
 */
import React from 'react';
import { useTranslation } from 'next-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  BilingualSubtitleInfo,
  SubtitleLinesMode,
} from '../../../types/subtitleMerge';

interface SubtitleLinesSelectProps {
  bilingual?: BilingualSubtitleInfo;
  value: SubtitleLinesMode;
  onChange: (value: SubtitleLinesMode) => void;
  disabled?: boolean;
}

export default function SubtitleLinesSelect({
  bilingual,
  value,
  onChange,
  disabled = false,
}: SubtitleLinesSelectProps) {
  const { t } = useTranslation('subtitleMerge');
  if (!bilingual) return null;

  const labels: Record<'top' | 'bottom', string> =
    bilingual.order === 'sourceAndTranslate'
      ? { top: t('subtitleLinesSource'), bottom: t('subtitleLinesTranslation') }
      : bilingual.order === 'translateAndSource'
        ? {
            top: t('subtitleLinesTranslation'),
            bottom: t('subtitleLinesSource'),
          }
        : { top: t('subtitleLinesTop'), bottom: t('subtitleLinesBottom') };

  return (
    <div className="space-y-1.5">
      <h3 className="label-caps">{t('subtitleLinesTitle')}</h3>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as SubtitleLinesMode)}
        disabled={disabled}
      >
        <SelectTrigger aria-label={t('subtitleLinesTitle')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="both">{t('subtitleLinesBoth')}</SelectItem>
          <SelectItem value="top">{labels.top}</SelectItem>
          <SelectItem value="bottom">{labels.bottom}</SelectItem>
        </SelectContent>
      </Select>
      {bilingual.order === 'unknown' && (
        <p className="text-xs text-muted-foreground">
          {t('subtitleLinesGuess')}
        </p>
      )}
      {bilingual.unresolved > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('subtitleLinesUnresolved', { count: bilingual.unresolved })}
        </p>
      )}
    </div>
  );
}
