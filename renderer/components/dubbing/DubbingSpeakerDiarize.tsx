import React, { useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { UseDubbingReturn } from '../../hooks/useDubbing';

const AUTO = 'auto';
const COUNTS = [2, 3, 4, 5, 6, 7, 8];

/**
 * Detect speakers from the loaded media, so each one can get its own voice.
 * One compact row: the explanation lives in the tooltip, not on screen, so the
 * cue list keeps its height.
 */
export default function DubbingSpeakerDiarize({
  dub,
  className = '',
}: {
  dub: UseDubbingReturn;
  className?: string;
}) {
  const { t } = useTranslation('dubbing');
  const [count, setCount] = useState(AUTO);
  const { diarizing, running, exporting, speakers } = dub;
  const hasSpeakers = speakers.length > 0;
  const busy =
    running || exporting || dub.loading || dub.configBlocked || !dub.videoPath;

  return (
    <div
      className={`flex min-w-0 items-center gap-2 ${className}`}
      title={hasSpeakers ? t('diarizeRedoWarn') : t('diarizeDesc')}
    >
      <Select
        value={count}
        onValueChange={setCount}
        disabled={busy || diarizing}
      >
        <SelectTrigger
          className="h-7 w-[104px] text-xs"
          aria-label={t('diarizeCount')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>{t('diarizeAuto')}</SelectItem>
          {COUNTS.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {t('diarizeCountOption', { count: n })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {diarizing ? (
        <>
          <Loader2
            className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
            aria-label={t('diarizeRunning')}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={dub.cancelDiarize}
          >
            {t('diarizeCancel')}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={busy}
          onClick={() =>
            dub.diarizeSpeakers(count === AUTO ? undefined : Number(count))
          }
        >
          <Users className="h-3 w-3" />
          {hasSpeakers ? t('diarizeRedo') : t('diarizeRun')}
        </Button>
      )}
    </div>
  );
}
